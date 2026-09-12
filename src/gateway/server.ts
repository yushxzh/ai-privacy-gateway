import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import type { Endpoint, Json, JsonObject, Settings, Snapshot } from '../shared/types'
import { PrivacyPipeline } from '../privacy/pipeline'
import { RuleSettings } from '../privacy/rule-settings'
import { GatewayError } from './errors'
import { prepareRequest } from './protocol'
import {
  ConfiguredProviderRouter,
  DEFAULT_SETTINGS,
  demoResponse,
  demoStream,
  validateSettings
} from './providers'
import { RecordStore } from './records'
import { clientTarget, nativeRoute } from './client-auth'
import { prepareWorkBuddyRequest, validateWorkBuddyUrl, workbuddyTarget, type WorkBuddyRoute } from './workbuddy'
import { RULES } from '../shared/rules'
import type { RuleTestResult, RuleSampleResult } from '../shared/types'

const REQUEST_LIMIT = 256 * 1024
const RESPONSE_LIMIT = 8 * 1024 * 1024
const ENDPOINTS: Endpoint[] = ['chat/completions', 'responses', 'messages', 'messages/count_tokens']

function sendJson(response: ServerResponse, status: number, body: Json): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const fail = (error: Error) => {
      cleanup()
      request.resume()
      reject(error)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > REQUEST_LIMIT) {
        fail(new GatewayError(413, 'request_too_large', '请求超过 256 KiB 限制。'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json)
      } catch {
        reject(new GatewayError(400, 'invalid_json', '请求正文必须为有效 JSON。'))
      }
    }
    const onError = () => fail(new GatewayError(400, 'request_interrupted', '请求已中断。'))
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onError)
    }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onError)
  })
}

function authorize(request: IncomingMessage, token: string, native: boolean): void {
  const supplied = native
    ? request.headers['x-privacy-gateway-token']
    : (request.headers.authorization?.replace(/^Bearer /i, '') ?? request.headers['x-api-key'])
  if (typeof supplied !== 'string')
    throw new GatewayError(401, 'unauthorized', '缺少本地网关令牌，请从接入页面重新生成配置。')
  const expected = Buffer.from(token)
  const actual = Buffer.from(supplied)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new GatewayError(401, 'unauthorized', '本地网关令牌无效，请从接入页面重新生成配置。')
}

export class PrivacyGateway extends EventEmitter {
  readonly records = new RecordStore()
  readonly token: string
  private workbuddyRoutes = new Map<string, WorkBuddyRoute>()
  private workbuddyControllers = new Map<AbortController, string>()
  private server?: Server
  private settings: Settings
  private apiKey = ''
  private lastError?: string
  private pipeline: PrivacyPipeline
  private controllers = new Set<AbortController>()
  private active = 0
  private control = Promise.resolve()

  constructor(settings: Settings = DEFAULT_SETTINGS, token?: string, rules = new RuleSettings()) {
    super()
    this.pipeline = new PrivacyPipeline(undefined, undefined, undefined, undefined, rules)
    this.settings = { ...settings }
    this.token = token ?? 'apg_' + randomBytes(32).toString('hex')
    this.records.on('change', () => this.emit('change'))
  }

  snapshot(): Snapshot {
    return {
      running: !!this.server?.listening,
      workbuddyEnabled: this.workbuddyRoutes.size > 0,
      baseUrl: `http://127.0.0.1:${this.settings.port}/v1`,
      settings: { ...this.settings },
      hasApiKey: !!this.apiKey,
      error: this.lastError,
      records: this.records.summaries(),
      counters: this.records.counts()
    }
  }

  workbuddyUrl(token: string): string {
    return `http://127.0.0.1:${this.settings.port}/workbuddy/${token}/v1/chat/completions`
  }

  setWorkbuddyRoutes(routes: WorkBuddyRoute[]): void {
    if (routes.length > 100) throw new Error('too-many-workbuddy-routes')
    const next = new Map<string, WorkBuddyRoute>()
    for (const route of routes) {
      if (!/^[a-f0-9]{64}$/.test(route.token) || next.has(route.token)) throw new Error('invalid-workbuddy-route')
      validateWorkBuddyUrl(route.url, this.settings.port)
      next.set(route.token, { ...route })
    }
    if (JSON.stringify([...next]) === JSON.stringify([...this.workbuddyRoutes])) return
    for (const [controller, token] of this.workbuddyControllers) {
      if (next.get(token)?.url !== this.workbuddyRoutes.get(token)?.url) controller.abort()
    }
    this.workbuddyRoutes = next
    this.emit('change')
  }

  async inspectRules(text: string): Promise<RuleTestResult> {
    if (typeof text !== 'string' || !text.trim() || text.length > 12000)
      throw new GatewayError(400, 'invalid_test_text', '请输入 1–12,000 个字符进行本地验证。')
    const started = performance.now()
    const result = await this.pipeline.process([text])
    try {
      return {
        action: result.decision.action, reason: result.decision.reason, sanitized: result.sanitized[0],
        findings: result.findings.map(({ value: _value, ...finding }) => finding),
        durationMs: Math.round((performance.now() - started) * 100) / 100
      }
    } finally { result.pseudonymizer.clear() }
  }

  async verifyRuleSamples(): Promise<RuleSampleResult[]> {
    const results: RuleSampleResult[] = []
    for (const rule of RULES) {
      for (const [sampleIndex, sample] of rule.samples.entries()) {
        const result = await this.inspectRules(sample.input)
        results.push({ ruleId: rule.id, sampleIndex, result,
          passed: result.action === sample.action && result.findings.some(hit => hit.ruleId === rule.id) === sample.hit })
      }
    }
    return results
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const next = this.control.then(operation)
    this.control = next.catch(() => {})
    return next
  }

  start(): Promise<void> {
    return this.serialize(() => this.startServer())
  }
  stop(): Promise<void> {
    return this.serialize(() => this.stopServer())
  }

  saveSettings(settings: Settings, apiKey: string): Promise<void> {
    return this.serialize(async () => {
      const validated = validateSettings(settings)
      if (typeof apiKey !== 'string' || apiKey.length > 8192 || /[\r\n]/.test(apiKey))
        throw new GatewayError(400, 'invalid_key', '上游凭据格式无效。')
      await this.stopServer()
      this.settings = validated
      this.apiKey = ['demo', 'client'].includes(validated.provider) ? '' : apiKey.trim()
      await this.startServer()
    })
  }

  private async startServer(): Promise<void> {
    if (this.server?.listening) return
    this.lastError = undefined
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        if (response.destroyed || response.writableEnded) return
        if (response.headersSent) {
          response.destroy()
          return
        }
        const known =
          error instanceof GatewayError
            ? error
            : new GatewayError(500, 'internal_error', '网关处理失败，请重试。')
        sendJson(response, known.status, {
          error: { message: known.message, type: known.code, code: known.code }
        })
      })
    })
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    server.keepAliveTimeout = 5000
    server.maxConnections = 32
    server.on('upgrade', (_request, socket) => {
      socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n')
    })
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.settings.port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      const address = server.address()
      if (address && typeof address !== 'string') this.settings.port = address.port
      this.server = server
      server.on('error', () => {
        this.lastError = '本地服务发生错误，请停止后重新启动。'
        this.emit('change')
      })
    } catch (error) {
      this.lastError =
        (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `端口 ${this.settings.port} 已被占用，请在设置中修改端口后重试。`
          : '本地端口启动失败，请检查端口和系统权限。'
      throw new GatewayError(503, 'listen_failed', this.lastError)
    } finally {
      this.emit('change')
    }
  }

  private async stopServer(): Promise<void> {
    for (const controller of this.controllers) controller.abort()
    const server = this.server
    this.server = undefined
    if (server?.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
    this.emit('change')
  }

  async demo(text: string): Promise<void> {
    if (!this.server?.listening) throw new GatewayError(503, 'not_running', '请先启动网关。')
    if (this.settings.provider !== 'demo')
      throw new GatewayError(400, 'demo_only', '请先切换到离线演示服务。')
    if (typeof text !== 'string' || !text.trim() || text.length > 12000)
      throw new GatewayError(400, 'invalid_demo', '请输入 1–12000 个字符。')
    const result = await fetch(this.snapshot().baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-privacy-demo': '1'
      },
      body: JSON.stringify({ model: this.settings.model, messages: [{ role: 'user', content: text }] }),
      signal: AbortSignal.timeout(10000)
    })
    await result.arrayBuffer()
    if (!result.ok && result.status !== 403)
      throw new GatewayError(result.status, 'demo_failed', '演示请求未完成，请检查网关状态。')
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('x-content-type-options', 'nosniff')
    if (
      ![`127.0.0.1:${this.settings.port}`, `localhost:${this.settings.port}`].includes(
        request.headers.host ?? ''
      ) ||
      request.headers.origin !== undefined
    ) {
      throw new GatewayError(403, 'local_clients_only', '只接受本机客户端请求。')
    }
    const path = request.url ?? ''
    if (request.method === 'GET' && path === '/health') {
      sendJson(response, 200, { status: 'ok', service: 'ai-privacy-gateway', mode: this.settings.provider })
      return
    }
    const native = nativeRoute(path)
    // 地址中的随机通行值用于本机鉴权，Bearer 保留给模型原服务；通行值不发给上游。
    const workbuddyPath = path.startsWith('/workbuddy/')
    const workbuddyMatch = path.match(/^\/workbuddy\/([a-f0-9]{64})\/v1\/(chat\/completions|models)$/)
    const workbuddy = workbuddyMatch ? this.workbuddyRoutes.get(workbuddyMatch[1]) : undefined
    if (workbuddyPath && !workbuddy)
      throw new GatewayError(this.workbuddyRoutes.size ? 401 : 409, 'workbuddy_disabled', '此自定义模型尚未接入，或本地连接地址已失效。请在接入页重新检查。')
    if (!workbuddyPath) authorize(request, this.token, !!native)
    if (native && this.settings.provider !== 'client')
      throw new GatewayError(409, 'native_mode_disabled', '请在接入页面启用「沿用客户端认证」。')
    const nativeTarget = workbuddy ? workbuddyTarget(request.headers, workbuddy.url)
      : native ? clientTarget(native.client, native.endpoint, request.headers) : undefined
    if (request.method === 'GET' && (path === '/v1/models' || (workbuddy && workbuddyMatch?.[2] === 'models'))) {
      sendJson(response, 200, {
        object: 'list',
        data: [
          {
            id: workbuddy?.id ?? this.settings.model,
            object: 'model',
            type: 'model',
            display_name: workbuddy?.id ?? this.settings.model,
            created: 0,
            owned_by: nativeTarget?.kind ?? this.settings.provider
          }
        ]
      })
      return
    }
    const endpoint = workbuddy ? workbuddyMatch![2] as Endpoint
      : native?.endpoint ?? (path.replace(/^\/v1\//, '') as Endpoint)
    if (request.method !== 'POST' || !ENDPOINTS.includes(endpoint))
      throw new GatewayError(404, 'unsupported_endpoint', '当前版本不支持此接口。')
    if (
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') ||
      request.headers['content-encoding']
    )
      throw new GatewayError(415, 'json_required', '仅接受未压缩的 application/json 请求。')
    if (Number(request.headers['content-length']) > REQUEST_LIMIT)
      throw new GatewayError(413, 'request_too_large', '请求超过 256 KiB 限制。')
    if (this.active >= 4)
      throw new GatewayError(429, 'too_many_requests', '当前并发请求已达上限，请稍后重试。')
    this.active++
    const controller = new AbortController()
    this.controllers.add(controller)
    if (workbuddy) this.workbuddyControllers.set(controller, workbuddy.token)
    const timer = setTimeout(() => controller.abort(), 60000)
    const abort = () => {
      if (!response.writableFinished) controller.abort()
    }
    response.on('close', abort)
    const settings = { ...this.settings }
    const apiKey = this.apiKey
    let processed: Awaited<ReturnType<PrivacyPipeline['process']>> | undefined
    let recordId: string | undefined
    let generation = 0
    const started = Date.now()
    try {
      const input = await readBody(request)
      if (controller.signal.aborted) throw new GatewayError(499, 'cancelled', '请求已取消。')
      const prepared = workbuddy ? prepareWorkBuddyRequest(input, workbuddy.url) : prepareRequest(input, endpoint)
      // WorkBuddy 的工具声明很长；记录保留检测前的文本请求，避免正文被无关元数据挤出预览。
      const original = JSON.stringify(workbuddy ? prepared.body : input, null, 2)
      processed = await this.pipeline.process(prepared.texts)
      const sanitized = prepared.apply(processed.sanitized)
      recordId = randomUUID()
      generation = this.records.add(
        {
          id: recordId,
          time: new Date().toISOString(),
          endpoint: workbuddy ? '/workbuddy/custom/chat/completions' : path,
          model: String(sanitized.model),
          provider: nativeTarget?.kind ?? settings.provider,
          ...(workbuddy ? { upstreamHost: new URL(workbuddy.url).host } : {}),
          action: processed.decision.action,
          categories: [...new Set(processed.findings.map((f) => f.category))],
          findings: processed.findings.length,
          ruleIds: [...new Set(processed.findings.map(finding => finding.ruleId))],
          ruleMatches: processed.ruleMatches,
          rulesRevision: processed.rulesRevision,
          status: processed.decision.action === 'BLOCK' ? 'blocked' : 'pending',
          durationMs: 0,
          note: processed.decision.reason,
          source: settings.provider === 'demo' && request.headers['x-privacy-demo'] === '1' ? 'demo' : 'api',
          stream: sanitized.stream === true
        },
        original,
        JSON.stringify(sanitized, null, 2)
      )
      response.setHeader('x-privacy-request-id', recordId)
      response.setHeader('x-privacy-action', processed.decision.action)
      if (processed.decision.action === 'BLOCK')
        throw new GatewayError(403, 'privacy_blocked', processed.decision.reason)
      const target =
        nativeTarget ?? new ConfiguredProviderRouter(settings, apiKey).resolve(endpoint, processed.decision)
      if (sanitized.stream) response.setHeader('x-privacy-rehydration', 'disabled-for-stream')
      if (target.kind === 'demo') {
        const data = demoResponse(endpoint, String(sanitized.model), processed.sanitized.join('\n'), recordId)
        if (sanitized.stream) {
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store'
          })
          response.end(demoStream(endpoint, data))
        } else sendJson(response, 200, processed.pseudonymizer.restore(data))
      } else {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          accept: sanitized.stream ? 'text/event-stream' : 'application/json'
        }
        if (nativeTarget) Object.assign(headers, nativeTarget.headers)
        else if (target.kind === 'anthropic') {
          if (target.apiKey) headers['x-api-key'] = target.apiKey
          headers['anthropic-version'] = String(request.headers['anthropic-version'] ?? '2023-06-01')
          if (request.headers['anthropic-beta'])
            headers['anthropic-beta'] = String(request.headers['anthropic-beta'])
        } else if (target.apiKey) headers.authorization = 'Bearer ' + target.apiKey
        const upstream = await fetch(target.url!, {
          method: 'POST',
          headers,
          body: JSON.stringify(sanitized),
          signal: controller.signal,
          redirect: 'error'
        })
        if (!upstream.ok) {
          await upstream.body?.cancel()
          throw new GatewayError(
            upstream.status,
            'upstream_error',
            `上游返回 HTTP ${upstream.status}，请检查模型、凭据或额度。`
          )
        }
        const type = upstream.headers.get('content-type') ?? ''
        if (
          (sanitized.stream && !type.includes('text/event-stream')) ||
          (!sanitized.stream && !type.includes('application/json'))
        ) {
          await upstream.body?.cancel()
          throw new GatewayError(502, 'invalid_upstream_response', '上游响应格式与请求不一致。')
        }
        if (!upstream.body) throw new GatewayError(502, 'empty_response', '上游没有返回响应正文。')
        if (sanitized.stream)
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store'
          })
        let size = 0
        const buffers: Uint8Array[] = []
        for await (const chunk of upstream.body) {
          size += chunk.byteLength
          if (size > RESPONSE_LIMIT) {
            controller.abort()
            throw new GatewayError(502, 'response_too_large', '上游响应超过 8 MiB 限制。')
          }
          if (sanitized.stream) {
            if (!response.write(chunk)) await once(response, 'drain', { signal: controller.signal })
          } else buffers.push(chunk)
        }
        if (sanitized.stream) response.end()
        else {
          let data: Json
          try {
            data = JSON.parse(Buffer.concat(buffers).toString('utf8')) as Json
          } catch {
            throw new GatewayError(502, 'invalid_upstream_json', '上游返回了无效的 JSON。')
          }
          sendJson(response, upstream.status, processed.pseudonymizer.restore(data))
        }
      }
      this.records.update(recordId, generation, {
        status: 'completed',
        httpStatus: 200,
        durationMs: Date.now() - started,
        note: sanitized.stream ? 'SSE 已转发；首版流式响应保留代号。' : processed.decision.reason
      })
    } catch (error) {
      const safe =
        error instanceof GatewayError
          ? error
          : controller.signal.aborted
            ? new GatewayError(504, 'request_timeout', '请求已取消或超过 60 秒限制。')
            : new GatewayError(502, 'upstream_unavailable', '无法完成上游请求，请检查服务地址与网络。')
      if (recordId)
        this.records.update(recordId, generation, {
          status: safe.code === 'privacy_blocked' ? 'blocked' : 'failed',
          httpStatus: safe.status,
          durationMs: Date.now() - started,
          note: safe.message
        })
      throw safe
    } finally {
      clearTimeout(timer)
      response.off('close', abort)
      this.controllers.delete(controller)
      this.workbuddyControllers.delete(controller)
      processed?.pseudonymizer.clear()
      this.active--
    }
  }
}
