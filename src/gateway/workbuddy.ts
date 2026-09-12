import type { IncomingHttpHeaders } from 'node:http'
import type { Json, JsonObject, ProviderKind } from '../shared/types'
import { GatewayError } from './errors'
import { prepareRequest } from './protocol'

export interface WorkBuddyRoute {
  id: string
  token: string
  url: string
}

export function validateWorkBuddyUrl(value: string, gatewayPort: number): URL {
  let url: URL
  try { url = new URL(value) } catch {
    throw new GatewayError(400, 'invalid_provider_url', '模型接口地址格式有误，请在 WorkBuddy 中检查。')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || value.length > 4096)
    throw new GatewayError(400, 'invalid_provider_url', '模型接口需使用 HTTP 或 HTTPS，且不能包含用户名、密码或片段。')
  if ([...url.searchParams.keys()].some(key => /(?:key|token|secret|password|authorization|signature|^sig$)/i.test(key)))
    throw new GatewayError(400, 'credentials_in_url', '请将认证信息放入 WorkBuddy 的 Key 栏，接口 URL 不能包含密钥参数。')
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && (Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === gatewayPort
      || /^\/workbuddy\/[a-f0-9]{64}\//.test(url.pathname)))
    throw new GatewayError(400, 'recursive_provider', '模型原地址不能指向本网关，请先恢复模型服务地址。')
  return url
}

export function workbuddyTarget(headers: IncomingHttpHeaders, url: string) {
  const forwarded: Record<string, string> = {}
  const bearer = headers.authorization
  if (bearer !== undefined) {
    if (typeof bearer !== 'string' || !/^Bearer [\x21-\x7e]{1,8192}$/i.test(bearer) || /^Bearer apg_/i.test(bearer))
      throw new GatewayError(401, 'workbuddy_key_invalid', 'WorkBuddy 传入的模型认证格式有误，请检查自定义模型的 Key。')
    forwarded.authorization = bearer
  }
  for (const name of ['x-api-key', 'api-key']) {
    const value = headers[name]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(value))
      throw new GatewayError(401, 'workbuddy_key_invalid', 'WorkBuddy 传入的模型认证格式有误。')
    forwarded[name] = value
  }
  const hostname = new URL(url).hostname
  const kind: ProviderKind = hostname === 'api.deepseek.com' ? 'deepseek'
    : hostname === 'api.openai.com' ? 'openai' : 'compatible'
  return { kind, url, apiKey: '', headers: forwarded }
}

export function prepareWorkBuddyRequest(input: Json, targetUrl: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new GatewayError(400, 'invalid_request', '请求正文格式有误。')
  const body: JsonObject = structuredClone(input)
  // 文本入口不转发 WorkBuddy 附带的工具声明；真实工具调用与结果仍由协议校验拒绝。
  if ('tools' in body && !Array.isArray(body.tools))
    throw new GatewayError(400, 'workbuddy_text_only', '工具声明格式有误；当前接入仅支持纯文本。')
  delete body.tools
  delete body.tool_choice
  delete body.parallel_tool_calls
  const messageMetadata = ['agent', 'messageId', 'model', 'requestModelId', 'requestModelName',
    'traceId', 'conversationRequestId', 'rawUsage', 'usage']
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue
      for (const field of messageMetadata) delete message[field]
    }
  }
  for (const field of ['frequency_penalty', 'presence_penalty']) {
    if (!(field in body)) continue
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] !== 0)
      throw new GatewayError(400, 'unsupported_parameter', '当前文本接入仅接受默认的惩罚参数。')
    delete body[field]
  }
  if ('n' in body) {
    if (body.n !== 1) throw new GatewayError(400, 'unsupported_parameter', '当前只支持一次返回一条回复。')
    delete body.n
  }
  if ('thinking' in body) {
    const thinking = body.thinking
    if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)
      || Object.keys(thinking).length !== 1 || thinking.type !== 'disabled')
      throw new GatewayError(400, 'workbuddy_text_only', '请在 WorkBuddy 自定义模型中关闭思考模式。')
    delete body.thinking
  }
  if ('reasoning_effort' in body) {
    if (body.reasoning_effort !== 'none')
      throw new GatewayError(400, 'workbuddy_text_only', '请在 WorkBuddy 自定义模型中关闭思考模式。')
    delete body.reasoning_effort
  }
  const prepared = prepareRequest(body, 'chat/completions')
  // 只对 DeepSeek 官方入口关闭其默认思考；其他服务不附加 DeepSeek 参数。
  if (new URL(targetUrl).hostname === 'api.deepseek.com') prepared.body.thinking = { type: 'disabled' }
  return prepared
}
