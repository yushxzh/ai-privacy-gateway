import type { Endpoint, Json, JsonObject } from '../shared/types'
import { GatewayError } from './errors'

const invalid = () => new GatewayError(400, 'unsupported_request', '当前版本仅支持文本请求和基础生成参数；工具、图片、文件与会话引用暂不支持。')
const isObject = (value: Json): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)

function onlyKeys(object: JsonObject, keys: string[]): void {
  if (Object.keys(object).some(key => !keys.includes(key))) throw invalid()
}

export function prepareRequest(input: Json, endpoint: Endpoint) {
  if (!isObject(input)) throw invalid()
  const body = structuredClone(input)
  const allowed = ['model', 'stream', 'temperature', 'top_p']
  if (endpoint === 'chat/completions') allowed.push('messages', 'max_tokens', 'max_completion_tokens', 'stream_options', 'stop')
  if (endpoint === 'responses') allowed.push('input', 'instructions', 'max_output_tokens', 'store')
  if (endpoint.startsWith('messages')) allowed.push('messages', 'system', 'max_tokens', 'stop_sequences')
  onlyKeys(body, allowed)
  if (typeof body.model !== 'string' || !/^[A-Za-z0-9_.:/-]{1,120}$/.test(body.model)) throw invalid()
  if ('stream' in body && typeof body.stream !== 'boolean') throw invalid()
  if (endpoint === 'messages/count_tokens' && body.stream) throw invalid()
  for (const key of ['temperature', 'top_p']) {
    if (key in body && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > (key === 'top_p' ? 1 : 2))) throw invalid()
  }
  for (const key of ['max_tokens', 'max_output_tokens', 'max_completion_tokens']) {
    if (key in body && (typeof body[key] !== 'number' || !Number.isInteger(body[key]) || body[key] < 1 || body[key] > 131072)) throw invalid()
  }
  if (endpoint === 'messages' && !('max_tokens' in body)) body.max_tokens = 1024
  if ('stream_options' in body) {
    if (!isObject(body.stream_options)) throw invalid()
    onlyKeys(body.stream_options, ['include_usage'])
    if (typeof body.stream_options.include_usage !== 'boolean') throw invalid()
  }
  if (endpoint === 'responses') {
    if ('store' in body && typeof body.store !== 'boolean') throw invalid()
    body.store = false
  }

  const texts: string[] = []
  const setters: ((text: string) => void)[] = []
  function addText(object: JsonObject | Json[], key: string | number) {
    const value = (object as JsonObject)[key]
    if (typeof value !== 'string') throw invalid()
    texts.push(value)
    setters.push(text => { (object as JsonObject)[key] = text })
  }
  function content(object: JsonObject, key: string) {
    const value = object[key]
    if (typeof value === 'string') { addText(object, key); return }
    if (!Array.isArray(value) || !value.length || value.length > 200) throw invalid()
    for (const block of value) {
      if (!isObject(block)) throw invalid()
      onlyKeys(block, ['type', 'text'])
      const types = endpoint === 'responses' ? ['input_text', 'output_text'] : ['text']
      if (typeof block.type !== 'string' || !types.includes(block.type)) throw invalid()
      addText(block, 'text')
    }
  }

  if (endpoint === 'responses' && typeof body.input === 'string') addText(body, 'input')
  else {
    const messages = body[endpoint === 'responses' ? 'input' : 'messages']
    if (!Array.isArray(messages) || !messages.length || messages.length > 200) throw invalid()
    for (const message of messages) {
      if (!isObject(message)) throw invalid()
      onlyKeys(message, endpoint === 'responses' ? ['type', 'role', 'content'] : ['role', 'content'])
      if ('type' in message && message.type !== 'message') throw invalid()
      const roles = endpoint.startsWith('messages') ? ['user', 'assistant'] : ['user', 'assistant', 'system', 'developer']
      if (typeof message.role !== 'string' || !roles.includes(message.role)) throw invalid()
      content(message, 'content')
    }
  }
  for (const key of ['instructions', 'system']) if (key in body) content(body, key)
  for (const key of ['stop', 'stop_sequences']) {
    if (!(key in body)) continue
    if (typeof body[key] === 'string' && key === 'stop') addText(body, key)
    else {
      const value = body[key]
      if (!Array.isArray(value) || value.length > 16) throw invalid()
      value.forEach((_, i) => addText(value, i))
    }
  }
  return { body, texts, apply: (values: string[]) => { setters.forEach((set, i) => set(values[i])); return body } }
}
