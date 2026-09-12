import type { Endpoint, JsonObject, Settings } from '../shared/types'
import type { PolicyDecision, ProviderRouter, ProviderTarget } from '../privacy/contracts'
import { GatewayError } from './errors'

export const DEFAULT_SETTINGS: Settings = { port: 8787, provider: 'demo', baseUrl: '', model: 'privacy-demo' }
export const PROVIDERS = ['demo', 'client', 'openai', 'deepseek', 'anthropic', 'compatible'] as const

export function validateSettings(settings: Settings): Settings {
  if (!settings || !Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) {
    throw new GatewayError(400, 'invalid_port', '端口需为 1024–65535 之间的整数。')
  }
  if (
    !PROVIDERS.includes(settings.provider) ||
    typeof settings.model !== 'string' ||
    !/^[A-Za-z0-9_.:/-]{1,120}$/.test(settings.model)
  ) {
    throw new GatewayError(400, 'invalid_settings', '请选择服务类型并填写有效模型名称。')
  }
  if (settings.provider === 'demo' || settings.provider === 'client')
    return { port: settings.port, provider: settings.provider, baseUrl: '', model: settings.model }
  let url: URL
  try {
    url = new URL(settings.baseUrl)
  } catch {
    throw new GatewayError(400, 'invalid_url', '上游地址不是有效的 URL。')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new GatewayError(
      400,
      'invalid_url',
      '云端上游必须使用 HTTPS；HTTP 仅支持本机地址。URL 不得包含凭据、查询参数或片段。'
    )
  }
  if (loopback && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === settings.port) {
    throw new GatewayError(400, 'gateway_loop', '上游不能指向网关自身的端口。')
  }
  return {
    port: settings.port,
    provider: settings.provider,
    baseUrl: url.toString().replace(/\/$/, ''),
    model: settings.model
  }
}

export class ConfiguredProviderRouter implements ProviderRouter {
  constructor(
    private settings: Settings,
    private apiKey: string
  ) {}
  resolve(endpoint: Endpoint, decision: PolicyDecision): ProviderTarget {
    if (decision.action === 'ROUTE')
      throw new GatewayError(501, 'routing_not_implemented', '自动路由接口尚未实现。')
    const { provider, baseUrl } = this.settings
    if (provider === 'demo') return { kind: provider, url: null, apiKey: '' }
    if (provider === 'client')
      throw new GatewayError(400, 'native_route_required', '请使用接入页面生成的客户端专用地址。')
    const isAnthropic = endpoint.startsWith('messages')
    if (
      (provider === 'anthropic') !== isAnthropic ||
      (provider === 'deepseek' && endpoint !== 'chat/completions')
    ) {
      throw new GatewayError(
        400,
        'provider_protocol_mismatch',
        '当前上游不支持此接口。请在设置中选择匹配的服务类型。'
      )
    }
    return { kind: provider, url: baseUrl.replace(/\/v1$/, '') + '/v1/' + endpoint, apiKey: this.apiKey }
  }
}

export function demoResponse(endpoint: Endpoint, model: string, text: string, id: string): JsonObject {
  const content = `本地演示：已收到处理后的文本。\n${text}`
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  if (endpoint === 'messages/count_tokens') return { input_tokens: Math.ceil(text.length / 4) }
  if (endpoint === 'responses')
    return {
      id: 'resp_' + id,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      model,
      status: 'completed',
      output: [
        {
          id: 'msg_' + id,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: content, annotations: [] }]
        }
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    }
  if (endpoint === 'messages')
    return {
      id: 'msg_' + id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  return {
    id: 'chatcmpl-' + id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage
  }
}

export function demoStream(endpoint: Endpoint, response: JsonObject): string {
  const frame = (data: unknown, event?: string) =>
    `${event ? 'event: ' + event + '\n' : ''}data: ${JSON.stringify(data)}\n\n`
  if (endpoint === 'responses') {
    const output = response.output as { content: { text: string }[] }[]
    return (
      frame(
        {
          type: 'response.created',
          response: { ...response, status: 'in_progress', output: [] },
          sequence_number: 0
        },
        'response.created'
      ) +
      frame(
        {
          type: 'response.output_text.delta',
          delta: output[0].content[0].text,
          output_index: 0,
          content_index: 0,
          sequence_number: 1
        },
        'response.output_text.delta'
      ) +
      frame({ type: 'response.completed', response, sequence_number: 2 }, 'response.completed')
    )
  }
  if (endpoint === 'messages') {
    const content = response.content as { text: string }[]
    return (
      frame(
        { type: 'message_start', message: { ...response, content: [], stop_reason: null } },
        'message_start'
      ) +
      frame(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        'content_block_start'
      ) +
      frame(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content[0].text } },
        'content_block_delta'
      ) +
      frame({ type: 'content_block_stop', index: 0 }, 'content_block_stop') +
      frame(
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 }
        },
        'message_delta'
      ) +
      frame({ type: 'message_stop' }, 'message_stop')
    )
  }
  const choices = response.choices as { message: { content: string } }[]
  const base = {
    id: response.id,
    object: 'chat.completion.chunk',
    model: response.model,
    created: response.created
  }
  return (
    frame({
      ...base,
      choices: [
        { index: 0, delta: { role: 'assistant', content: choices[0].message.content }, finish_reason: null }
      ]
    }) +
    frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
    'data: [DONE]\n\n'
  )
}
