import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { NativeInspection, type NativeRequest } from './native-inspection'
import type { RecordStore } from './records'
import { RuleSettings } from '../privacy/rule-settings'

/** 仅供受控 TLS 子进程使用；独立令牌不与公开 API 或上游认证共用。 */
export class NativeBridge {
  readonly token = randomBytes(32).toString('hex')
  readonly inspection: NativeInspection
  private server?: Server
  private active = 0
  private ready?: () => void
  private readyPromise?: Promise<void>
  url = ''

  constructor(records: RecordStore, rules = new RuleSettings()) { this.inspection = new NativeInspection(records, rules) }

  async start(): Promise<void> {
    if (this.server) throw new Error('HTTPS 检查入口已启动。')
    this.readyPromise = new Promise(resolve => { this.ready = resolve })
    const server = createServer(async (request, response) => {
      const reply = (status: number, data: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(data))
      }
      const supplied = request.headers.authorization
      const expected = Buffer.from('Bearer ' + this.token)
      if (request.method !== 'POST' || request.headers.origin || request.headers.host !== new URL(this.url).host ||
        typeof supplied !== 'string' || Buffer.byteLength(supplied) !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), expected)) {
        reply(403, { error: '本地 HTTPS 检查入口拒绝此请求。' }); request.resume(); return
      }
      if (this.active >= 4) { reply(429, { error: '本地检查繁忙，请稍后重试。' }); request.resume(); return }
      this.active++
      try {
        let bytes = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          bytes += chunk.length
          if (bytes > 8 * 1024 * 1024) throw new Error('请求超过限制。')
          chunks.push(chunk)
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!input || typeof input !== 'object') throw new Error('参数无效。')
        if (request.url === '/ready') { this.ready?.(); reply(200, { ok: true }) }
        else if (request.url === '/health') reply(200, { ok: true })
        else if (request.url === '/inspect') reply(200, await this.inspection.inspect(input as NativeRequest))
        else if (request.url === '/confirm') reply(200, this.inspection.confirm(input.id, input.body, input.authenticationUnchanged))
        else if (request.url === '/finish') {
          if (typeof input.id !== 'string' || (input.status !== undefined && !Number.isInteger(input.status))) throw new Error('参数无效。')
          this.inspection.finish(input.id, input.status, input.failed === true ? 'HTTPS 传输未成功完成。' : undefined)
          reply(200, { ok: true })
        } else reply(404, { error: '未知检查操作。' })
      } catch {
        if (!response.headersSent) reply(400, { error: '本地检查失败，原请求必须阻断。' })
      } finally { this.active-- }
    })
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    this.server = server
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法创建本地检查入口。')
    this.url = `http://127.0.0.1:${address.port}`
  }

  async waitUntilReady(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.readyPromise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('TLS 代理未就绪。')), 15_000)
        timer.unref()
      })])
    } finally { if (timer) clearTimeout(timer) }
  }

  async stop(): Promise<void> {
    this.inspection.close()
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
  }
}
