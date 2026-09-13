import { createHash, randomUUID } from 'node:crypto'
import type { Action, Json, RecordSummary } from '../shared/types'
import { PrivacyPipeline } from '../privacy/pipeline'
import { RuleSettings } from '../privacy/rule-settings'
import { RecordStore } from './records'

export interface NativeField { path: (string | number)[]; text: string }
export interface NativeRequest {
  host: string
  path: string
  model: string
  stream: boolean
  fields: NativeField[]
}
interface Pending {
  generation: number
  started: number
  fields: NativeField[]
  originals: string[]
  confirmed: boolean
  timer: ReturnType<typeof setTimeout>
}

const MAX_BYTES = 4 * 1024 * 1024

function atPath(value: unknown, path: (string | number)[]): unknown {
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined
    value = (value as Record<string | number, unknown>)[key]
  }
  return value
}

function strings(value: Json): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(strings)
}

/** TLS 入口只提交内容字段；认证头留在代理内，不进入记录或检测器。 */
export class NativeInspection {
  private pending = new Map<string, Pending>()
  private pipeline: PrivacyPipeline
  private generation = 0

  constructor(private records: RecordStore, rules = new RuleSettings()) {
    this.pipeline = new PrivacyPipeline(undefined, undefined, undefined, undefined, rules)
  }

  /** 未检查的请求只记录固定原因，不保存正文、认证、查询参数或未知路径。 */
  unchecked(issue: RecordSummary['inspectionIssue']): void {
    if (!issue || !['unsupported', 'outside-scope', 'check-failed'].includes(issue)) throw new Error('检查状态无效。')
    const outside = issue === 'outside-scope'
    const notes = {
      unsupported: '受保护的模型端点使用了不支持的协议、字段或内容，请求已停止外发。',
      'outside-scope': '此请求不属于已适配的模型端点，未检查正文；不计为规则检查后放行。',
      'check-failed': '本地内容检查未完成，请求已停止外发。'
    }
    this.records.add({ id: randomUUID(), time: new Date().toISOString(),
      endpoint: outside ? '/未适配端点' : '/模型请求检查失败', model: '未检查请求',
      provider: 'client', upstreamHost: 'www.workbuddy.ai', source: 'api', transport: 'https-proxy',
      inspectionIssue: issue, action: outside ? 'ALLOW' : 'BLOCK', categories: [], findings: 0,
      status: outside ? 'completed' : 'failed', durationMs: 0, stream: false,
      httpStatus: outside ? undefined : issue === 'unsupported' ? 422 : 502, note: notes[issue]
    }, '', '')
  }

  async inspect(request: NativeRequest): Promise<{ id: string; action: Action; fields: NativeField[] }> {
    if (this.pending.size >= 16) throw new Error('原生请求数量超过限制。')
    if (request.host !== 'www.workbuddy.ai' || !/^\/[\w/.-]{1,180}$/.test(request.path) ||
      typeof request.model !== 'string' || request.model.length > 120 || typeof request.stream !== 'boolean' ||
      !Array.isArray(request.fields) || request.fields.length === 0 || request.fields.length > 4000 ||
      request.fields.some(field => !Array.isArray(field.path) || field.path.length === 0 || field.path.length > 30 ||
        field.path.some(key => typeof key !== 'string' && !Number.isSafeInteger(key)) || typeof field.text !== 'string') ||
      Buffer.byteLength(JSON.stringify(request.fields)) > MAX_BYTES) throw new Error('尚不支持此原生请求格式。')
    const started = Date.now()
    const id = randomUUID()
    const inspectionGeneration = this.generation
    const result = await this.pipeline.process(request.fields.map(field => field.text))
    try {
      if (inspectionGeneration !== this.generation) throw new Error('检查入口已停止。')
      const fields = request.fields.map((field, index) => ({ path: [...field.path], text: result.sanitized[index] }))
      const summary: RecordSummary = {
        id, time: new Date(started).toISOString(), endpoint: request.path, model: request.model,
        provider: 'client', upstreamHost: request.host, source: 'api', transport: 'https-proxy',
        stream: request.stream, action: result.decision.action,
        categories: [...new Set(result.findings.map(finding => finding.category))],
        ruleIds: [...new Set(result.findings.map(finding => finding.ruleId))],
        ruleMatches: result.ruleMatches, rulesRevision: result.rulesRevision,
        findings: result.findings.length, durationMs: 0,
        status: result.decision.action === 'BLOCK' ? 'blocked' : 'pending',
        note: result.decision.action === 'BLOCK' ? result.decision.reason : '本地检查已完成，等待校验实际发送正文。'
      }
      // 长系统说明和工具定义可能淹没用户输入，预览优先展示最新消息的变更字段。
      const changed = fields.map((field, index) => ({ field, original: request.fields[index] }))
        .filter(({ field, original }) => field.text !== original.text)
      const preview = (changed.length ? changed : fields.map((field, index) => ({ field, original: request.fields[index] })))
        .sort((a, b) => {
          const rank = (field: NativeField) => field.path[0] === 'messages' && typeof field.path[1] === 'number' ? field.path[1] + 1 : 0
          return rank(b.field) - rank(a.field)
        })
      const generation = this.records.add(summary, JSON.stringify(preview.map(row => row.original), null, 2), JSON.stringify(preview.map(row => row.field), null, 2))
      if (result.decision.action !== 'BLOCK') {
        const timer = setTimeout(() => this.finish(id, undefined, '代理请求超时，未确认完成。'), 120_000)
        timer.unref()
        this.pending.set(id, { generation, started, fields,
          originals: [...new Set(result.findings.map(finding => finding.value))], confirmed: false, timer })
      }
      return { id, action: result.decision.action, fields }
    } finally { result.pseudonymizer.clear() }
  }

  /** 在 TLS 引擎写入上游之前，核对它最终的 UTF-8 JSON 缓冲区。 */
  confirm(id: string, body: string, authenticationUnchanged: boolean) {
    const entry = this.pending.get(id)
    if (!entry || entry.confirmed) throw new Error('请求已失效或重复确认。')
    try {
      if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES || authenticationUnchanged !== true)
        throw new Error('发送正文或原认证校验失败。')
      const json = JSON.parse(body) as Json
      if (entry.fields.some(field => atPath(json, field.path) !== field.text)) throw new Error('实际发送字段与替换结果不一致。')
      const values = strings(json)
      if (entry.originals.some(original => values.some(value => value.includes(original)))) throw new Error('实际发送正文仍包含命中原文。')
      const outbound = { sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
        bytes: Buffer.byteLength(body), authenticationUnchanged: true, originalsAbsent: true }
      entry.confirmed = true
      entry.fields = []
      entry.originals = []
      this.records.update(id, entry.generation, { outbound, note: '实际发送正文已通过校验，等待原官方服务响应。' })
      return outbound
    } catch (error) {
      this.finish(id, undefined, '发送校验失败，代理必须阻断此请求。')
      throw error
    }
  }

  finish(id: string, httpStatus?: number, failure?: string): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    const completed = entry.confirmed && httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300 && !failure
    this.records.update(id, entry.generation, { status: completed ? 'completed' : 'failed',
      httpStatus, durationMs: Date.now() - entry.started,
      note: completed ? '请求正文已校验；原官方服务返回成功。认证沿用 WorkBuddy。' : failure ?? '原官方服务未成功完成请求。' })
    entry.fields = []
    entry.originals = []
  }

  close(): void {
    this.generation++
    for (const id of this.pending.keys()) this.finish(id, undefined, 'HTTPS 代理已停止，请求未确认完成。')
  }
}
