import type { IncomingHttpHeaders } from 'node:http'
import type { Endpoint } from '../shared/types'
import { GatewayError } from './errors'

export type NativeClient = 'codex' | 'claude'

export function nativeRoute(path: string): { client: NativeClient; endpoint: Endpoint } | undefined {
  if (path === '/native/codex/responses') return { client: 'codex', endpoint: 'responses' }
  if (path === '/native/claude/v1/messages') return { client: 'claude', endpoint: 'messages' }
  if (path === '/native/claude/v1/messages/count_tokens')
    return { client: 'claude', endpoint: 'messages/count_tokens' }
  return undefined
}

// 原认证只转发到所属服务的固定地址，不经过可配置上游，也不读取客户端凭据文件。
export function clientTarget(client: NativeClient, endpoint: Endpoint, incoming: IncomingHttpHeaders) {
  const headers: Record<string, string> = {}
  const copy = (name: string) => {
    const value = incoming[name]
    if (typeof value === 'string' && value.length <= 8192) headers[name] = value
  }
  const bearer = incoming.authorization
  if (typeof bearer === 'string' && /^Bearer \S+$/i.test(bearer) && !/^Bearer apg_/i.test(bearer))
    copy('authorization')
  if (client === 'codex') {
    if (endpoint !== 'responses')
      throw new GatewayError(400, 'protocol_mismatch', 'Codex 转发入口仅支持 Responses。')
    if (!headers.authorization)
      throw new GatewayError(401, 'client_auth_required', '未收到 Codex 原认证，请在 Codex 中完成登录。')
    if (incoming['x-openai-fedramp'])
      throw new GatewayError(400, 'unsupported_account', '当前固定路由尚未适配此账户的专用服务地址。')
    for (const name of [
      'chatgpt-account-id',
      'openai-organization',
      'openai-project',
      'openai-beta',
      'originator',
      'version',
      'user-agent'
    ])
      copy(name)
    const base = headers['chatgpt-account-id']
      ? 'https://chatgpt.com/backend-api/codex'
      : 'https://api.openai.com/v1'
    return { kind: 'openai' as const, url: `${base}/responses`, apiKey: '', headers }
  }
  if (!endpoint.startsWith('messages'))
    throw new GatewayError(400, 'protocol_mismatch', 'Claude 转发入口仅支持 Messages。')
  if (typeof incoming['x-api-key'] === 'string' && !incoming['x-api-key'].startsWith('apg_'))
    copy('x-api-key')
  if (!headers.authorization && !headers['x-api-key'])
    throw new GatewayError(401, 'client_auth_required', '未收到 Claude Code 原认证，请在客户端完成登录。')
  for (const name of Object.keys(incoming)) if (name.startsWith('anthropic-')) copy(name)
  copy('user-agent')
  headers['anthropic-version'] ??= '2023-06-01'
  return { kind: 'anthropic' as const, url: `https://api.anthropic.com/v1/${endpoint}`, apiKey: '', headers }
}
