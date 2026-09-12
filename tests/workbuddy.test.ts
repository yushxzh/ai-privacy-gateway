import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrivacyGateway } from '../src/gateway/server'
import { RuleSettings } from '../src/privacy/rule-settings'
import { DEFAULT_SETTINGS } from '../src/gateway/providers'
import { WorkBuddyConnections } from '../src/main/workbuddy-config'
import { createServer } from 'node:http'
import type { JsonObject } from '../src/shared/types'

const chat = (content: string): JsonObject => ({
  model: 'deepseek-flash', messages: [{ role: 'user', content }]
})

async function setup(t: TestContext) {
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0 }, undefined, rules)
  await gateway.start()
  const route = { id: 'deepseek-flash', token: 'a'.repeat(64), url: 'https://api.deepseek.com/chat/completions' }
  const enable = () => gateway.setWorkbuddyRoutes([route])
  const url = gateway.workbuddyUrl(route.token)
  t.after(() => gateway.stop())
  const actualFetch = globalThis.fetch
  const sent: { url: string; headers: Headers; body: any; redirect?: RequestRedirect }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return actualFetch(url, init)
    const body = JSON.parse(String(init?.body))
    sent.push({ url: String(url), headers: new Headers(init?.headers), body, redirect: init?.redirect })
    const content = body.messages[0].content
    if (body.stream) return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }
    )
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
      { headers: { 'content-type': 'application/json' } })
  })
  const post = (body: JsonObject, key = 'synthetic-deepseek-key', url = gateway.workbuddyUrl(route.token), extra = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, ...extra },
      body: JSON.stringify(body)
    })
  return { gateway, sent, post, enable, url, rules }
}

test('WorkBuddy 默认关闭；开启后校验专属地址与传入认证，浏览器及错误路由被拒绝', async t => {
  const { gateway, sent, post, enable, url } = await setup(t)
  assert.equal((await post(chat('hello'))).status, 409)
  enable()
  assert.equal((await post(chat('hello'), 'apg_not-an-upstream-key')).status, 401)
  assert.equal((await post(chat('hello'), '')).status, 401)
  assert.equal((await post(chat('hello'), 'synthetic', url.replace(/\/[a-f0-9]{64}\//, '/wrong/'))).status, 401)
  assert.equal((await post(chat('hello'), 'synthetic', url, { origin: 'https://example.com' })).status, 403)
  assert.equal((await post(chat('hello'), 'synthetic', url.replace('chat/completions', 'models'))).status, 404)
  assert.equal(sent.length, 0)
})

test('WorkBuddy Key 按请求转发到固定 DeepSeek 地址；只外发替换后的文本，认证不进入记录', async t => {
  const { gateway, sent, post, enable, url } = await setup(t)
  enable()
  for (const key of ['synthetic-deepseek-one', 'synthetic-deepseek-two']) {
    const response = await post({ ...chat('user@example.com 13800138000'), n: 1,
      frequency_penalty: 0, presence_penalty: 0 }, key, url, { 'x-private-header': 'local-only' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-privacy-action'), 'MASK')
    assert.equal((await response.json()).choices[0].message.content, 'user@example.com 13800138000')
    const upstream = sent.at(-1)!
    assert.equal(upstream.url, 'https://api.deepseek.com/chat/completions')
    assert.equal(upstream.headers.get('authorization'), 'Bearer ' + key)
    assert.equal(upstream.headers.get('x-private-header'), null)
    assert.equal(upstream.redirect, 'error')
    assert.deepEqual(upstream.body.thinking, { type: 'disabled' })
    assert.equal(upstream.body.frequency_penalty, undefined)
    assert.ok(!JSON.stringify(upstream.body).includes('user@example.com'))
    assert.ok(!JSON.stringify(upstream.body).includes('13800138000'))
    const summary = gateway.snapshot().records[0]
    assert.equal(summary.endpoint, '/workbuddy/custom/chat/completions')
    assert.equal(summary.provider, 'deepseek')
    assert.equal(summary.upstreamHost, 'api.deepseek.com')
    const detail = JSON.stringify(gateway.records.detail(summary.id, true))
    assert.ok(!detail.includes(key))
    assert.ok(!detail.includes(new URL(url).pathname.split('/')[2]))
  }
  assert.equal(sent.length, 2)
  assert.equal(gateway.snapshot().settings.provider, 'demo')
  assert.equal(gateway.snapshot().hasApiKey, false)
})

test('WorkBuddy 凭据正文阻断；工具、图片、思考和未知字段拒绝外发；SSE 保留占位符', async t => {
  const { gateway, sent, post, enable, url, rules } = await setup(t)
  enable()
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
  assert.equal((await post(chat('password=example_demo_123'))).status, 403)
  for (const payload of [
    { ...chat('hello'), messages: [{ role: 'tool', content: 'private tool result' }] },
    { ...chat('hello'), messages: [{ role: 'assistant', content: '', tool_calls: [] }] },
    { ...chat('hello'), thinking: { type: 'enabled' } },
    { ...chat('hello'), metadata: { email: 'private@example.com' } },
    { ...chat('hello'), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'https://example.com' }] }] }
  ]) assert.equal((await post(payload)).status, 400)
  assert.equal(sent.length, 0)
  const response = await post({ ...chat('user@example.com'),
    messages: [{ role: 'user', content: 'user@example.com', agent: { name: 'agent-private@example.com' } }],
    stream: true, stream_options: { include_usage: true },
    tools: [{ type: 'function', function: { name: 'do_not_run', description: 'tool-secret@example.com' } }],
    tool_choice: 'auto', parallel_tool_calls: true })
  assert.equal(response.status, 200)
  const stream = await response.text()
  assert.ok(stream.includes('⟦EMAIL_'))
  assert.ok(!stream.includes('user@example.com'))
  assert.ok(stream.endsWith('data: [DONE]\n\n'))
  assert.equal(sent[0].body.tools, undefined)
  assert.equal(sent[0].body.tool_choice, undefined)
  assert.equal(sent[0].body.parallel_tool_calls, undefined)
  assert.equal(sent[0].body.messages[0].agent, undefined)
  assert.ok(!JSON.stringify(sent[0].body).includes('tool-secret@example.com'))
  assert.ok(!JSON.stringify(sent[0].body).includes('agent-private@example.com'))
  const original = gateway.records.detail(gateway.snapshot().records[0].id, true)?.original
  assert.ok(original?.includes('user@example.com'))
  assert.ok(!original?.includes('tool-secret@example.com'))
  assert.ok(!original?.includes('agent-private@example.com'))
  gateway.setWorkbuddyRoutes([])
  assert.equal((await post(chat('hello'))).status, 409)
  assert.equal(sent.length, 1)
})

test('WorkBuddy 多轮历史只转发检查后的角色与文本，不外发消息来源、用量和追踪元数据', async t => {
  const { gateway, sent, post, enable, url } = await setup(t)
  enable()
  const payload: JsonObject = {
    ...chat('hello'),
    messages: [
      { role: 'system', content: 'Only format the supplied text.' },
      { role: 'user', content: 'first@example.com', agent: 'local-agent' },
      { role: 'assistant', content: 'Previous reply', messageId: 'local-message', model: 'local-model',
        requestModelId: 'local-model-id', requestModelName: 'local-model-name', traceId: 'local-trace',
        conversationRequestId: 'local-request', rawUsage: { text: 'private@example.com' },
        agent: { name: 'local-agent' }, usage: { prompt_tokens: 32 } },
      { role: 'user', content: 'first@example.com 13800138000', agent: 'local-agent' }
    ]
  }
  assert.equal((await post(payload)).status, 200)
  assert.equal(sent.length, 1)
  const messages = sent[0].body.messages
  assert.equal(messages.length, 4)
  assert.deepEqual(messages[2], { role: 'assistant', content: 'Previous reply' })
  assert.ok(messages[1].content.startsWith('⟦EMAIL_'))
  assert.ok(messages[3].content.startsWith(messages[1].content))
  const outgoing = JSON.stringify(sent[0].body)
  for (const value of ['first@example.com', '13800138000', 'private@example.com', 'local-agent', 'local-trace'])
    assert.ok(!outgoing.includes(value))
})

test('多个自定义 API 分别保留来源和 Key；内置项不变，关闭恢复原配置，重启恢复接入', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbuddy-connections-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0 }, undefined, rules)
  await gateway.start(); t.after(() => gateway.stop())
  const path = join(dir, 'models.json'), state = join(dir, 'connections.json')
  const connections = new WorkBuddyConnections(path, state, gateway)
  assert.equal((await connections.configuration()).models.length, 0)
  const rows = [
    { id: 'gpt-test', name: 'OpenAI 测试', vendor: 'OpenAI', url: 'https://api.openai.com/v1', apiKey: 'synthetic-openai', supportsToolCall: true },
    { id: 'qwen/test-model', vendor: 'Custom', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', apiKey: 'synthetic-qwen', supportsImages: true },
    { id: 'local/model', url: 'http://127.0.0.1:11434/v1/chat/completions', apiKey: '', supportsReasoning: false },
    { id: 'custom-proxy', url: 'https://proxy.example/inference?api-version=2025-01', apiKey: 'synthetic-proxy', useCustomProtocol: true },
    { id: 'builtin-model', type: 'builtin', url: 'https://builtin.example/chat/completions', apiKey: 'synthetic-builtin' }
  ]
  for (const document of [rows, { models: rows, availableModels: ['gpt-test'] }]) {
    await writeFile(path, JSON.stringify(document))
    let config = await connections.configuration()
    assert.equal(config.models.length, 4)
    assert.equal(config.enabled, false)
    assert.ok(!JSON.stringify(config).includes('synthetic-'))
    for (const row of rows.slice(0, 4)) config = await connections.setModel(row.id, true)
    assert.equal(config.models.filter(model => model.connected).length, 4)
    const saved = JSON.parse(await readFile(path, 'utf8'))
    const updated = Array.isArray(saved) ? saved : saved.models
    for (let i = 0; i < 4; i++) {
      assert.equal(updated[i].apiKey, rows[i].apiKey)
      assert.equal(updated[i].url, config.models[i].gatewayUrl)
      assert.equal(updated[i].supportsToolCall, false)
      assert.equal(updated[i].supportsImages, false)
      assert.equal(updated[i].supportsReasoning, false)
      assert.equal(updated[i].useCustomProtocol, true)
    }
    assert.deepEqual(updated[4], rows[4])
    assert.ok(!JSON.stringify(config).includes('synthetic-'))
    assert.ok(!(await readFile(state, 'utf8')).includes('synthetic-'))
    assert.ok(!(await readFile(state, 'utf8')).includes('apiKey'))
    const reopened = new WorkBuddyConnections(path, state, gateway)
    assert.equal((await reopened.configuration()).models.filter(model => model.connected).length, 4)
    for (const row of rows.slice(0, 4)) await reopened.setModel(row.id, false)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document)
    assert.equal(gateway.snapshot().workbuddyEnabled, false)
    await assert.rejects(() => reopened.setModel('builtin-model', true))
  }
  await writeFile(path, JSON.stringify([{ id: 'm', url: 'https://example.com?api_key=secret' }]))
  assert.ok((await connections.configuration()).models[0].issue)
  await assert.rejects(() => connections.setModel('m', true))
  const duplicate = JSON.stringify([{ id: 'm', url: 'https://one.example' }, { id: 'm', url: 'https://two.example' }])
  await writeFile(path, duplicate)
  assert.ok((await connections.configuration()).models.every(model => model.issue))
  await assert.rejects(() => connections.setModel('m', true))
  assert.equal(await readFile(path, 'utf8'), duplicate)
  await writeFile(path, '{invalid')
  assert.ok((await connections.configuration()).error)
  assert.equal(gateway.snapshot().workbuddyEnabled, false)
})

test('WorkBuddy 任意模型与来源通过真实 HTTP 分别路由；无 Key 本地服务、替换及阻断可用', async t => {
  const received: { path: string; auth?: string; body: any }[] = []
  const upstream = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    received.push({ path: request.url!, auth: request.headers.authorization, body })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: body.messages[0].content } }] }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())))
  const upstreamPort = (upstream.address() as { port: number }).port
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0 }, undefined, rules)
  await gateway.start(); t.after(() => gateway.stop())
  const routes = [
    { id: 'gpt/custom-model', token: 'b'.repeat(64), url: `http://127.0.0.1:${upstreamPort}/one/chat/completions` },
    { id: 'qwen-local', token: 'c'.repeat(64), url: `http://127.0.0.1:${upstreamPort}/second/custom-path?api-version=1` }
  ]
  gateway.setWorkbuddyRoutes(routes)
  for (const [i, route] of routes.entries()) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (i === 0) headers.authorization = 'Bearer synthetic-provider-one'
    const response = await fetch(gateway.workbuddyUrl(route.token), { method: 'POST', headers,
      body: JSON.stringify({ model: route.id, messages: [{ role: 'user', content: 'test@example.com 13800138000' }] }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-privacy-action'), 'MASK')
    assert.ok((await response.text()).includes('test@example.com'))
    assert.equal(received[i].path, new URL(route.url).pathname + new URL(route.url).search)
    assert.equal(received[i].auth, i === 0 ? 'Bearer synthetic-provider-one' : undefined)
    assert.equal(received[i].body.model, route.id)
    assert.equal(received[i].body.thinking, undefined)
    assert.ok(!JSON.stringify(received[i].body).includes('test@example.com'))
    assert.ok(!JSON.stringify(received[i].body).includes('13800138000'))
  }
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
  assert.equal((await fetch(gateway.workbuddyUrl(routes[0].token), { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-provider-one' },
    body: JSON.stringify({ model: routes[0].id, messages: [{ role: 'user', content: 'password=synthetic123' }] }) })).status, 403)
  assert.equal(received.length, 2)
  gateway.setWorkbuddyRoutes([routes[1]])
  assert.equal((await fetch(gateway.workbuddyUrl(routes[0].token), { method: 'POST' })).status, 401)
  assert.equal((await fetch(gateway.workbuddyUrl(routes[1].token).replace('chat/completions', 'models'))).status, 200)
  assert.throws(() => gateway.setWorkbuddyRoutes([{ ...routes[0], url: gateway.workbuddyUrl(routes[1].token) }]))
})

test('外部修改来源、能力或删除模型后撤销旧入口，重新接入只保留现存模型的恢复资料', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'workbuddy-external-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0 }, undefined, rules)
  await gateway.start(); t.after(() => gateway.stop())
  const path = join(dir, 'models.json'), state = join(dir, 'connections.json')
  const connections = new WorkBuddyConnections(path, state, gateway)
  const original = { id: 'custom-model', url: 'https://one.example/v1', apiKey: 'synthetic-preserved', supportsToolCall: true }
  await writeFile(path, JSON.stringify([original]))
  const enabled = await connections.setModel(original.id, true)
  const oldUrl = enabled.models[0].gatewayUrl!
  const changed = { ...original, url: 'https://two.example/v1', supportsToolCall: false }
  await writeFile(path, JSON.stringify([changed]))
  assert.equal((await connections.configuration()).enabled, false)
  assert.equal((await fetch(oldUrl, { method: 'POST' })).status, 409)
  const reenabled = await connections.setModel(original.id, true)
  assert.equal(reenabled.models[0].sourceUrl, changed.url)
  assert.notEqual(reenabled.models[0].gatewayUrl, oldUrl)
  const inFile = JSON.parse(await readFile(path, 'utf8'))
  inFile[0].supportsImages = true
  await writeFile(path, JSON.stringify(inFile))
  await connections.setModel(original.id, false)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), [{ ...changed, supportsImages: true }])
  await writeFile(path, JSON.stringify([{ id: 'new-model', url: 'http://localhost:11434/v1', apiKey: '' }]))
  await connections.setModel('new-model', true)
  assert.deepEqual(JSON.parse(await readFile(state, 'utf8')).routes.map((row: { id: string }) => row.id), ['new-model'])
  await writeFile(state, '{invalid')
  assert.ok((await connections.configuration()).error)
  assert.equal(gateway.snapshot().workbuddyEnabled, false)
})
