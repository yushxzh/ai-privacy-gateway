const baseUrl = process.env.OPENAI_BASE_URL
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.PRIVACY_GATEWAY_MODEL

if (!baseUrl || !apiKey || !model) {
  throw new Error('请先在 App「接入应用 → OpenAI SDK」复制并执行本次会话的环境变量。')
}
const target = new URL(baseUrl)
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('本示例只接受本机网关地址。')
}

const response = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: '请联系 demo.user@example.com，演示手机号为 13800138000。' }] }),
  signal: AbortSignal.timeout(60000)
})
if (!response.ok) throw new Error(`网关返回 HTTP ${response.status}，请在 App 中检查记录。`)
console.log(JSON.stringify(await response.json(), null, 2))
