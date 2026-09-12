import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { PrivacyGateway } from '../src/gateway/server'
import { RuleSettings } from '../src/privacy/rule-settings'
import { DEFAULT_SETTINGS } from '../src/gateway/providers'
import type { JsonObject, ProviderKind } from '../src/shared/types'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function setup(
  t: TestContext,
  upstream?: (req: IncomingMessage, res: ServerResponse) => void,
  provider: ProviderKind = 'openai'
) {
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0 }, 'local-test-token', rules)
  await gateway.start()
  t.after(() => gateway.stop())
  if (upstream) {
    const server = createServer(upstream)
    const port = await listen(server)
    t.after(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
    )
    await gateway.saveSettings(
      {
        ...gateway.snapshot().settings,
        provider,
        model: 'test-model',
        baseUrl: `http://127.0.0.1:${port}/v1`
      },
      'upstream-test-token'
    )
  }
  const base = gateway.snapshot().baseUrl
  const post = (body: JsonObject, path = '/chat/completions', headers = {}, signal?: AbortSignal) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer local-test-token', ...headers },
      body: JSON.stringify(body),
      signal
    })
  return { gateway, base, post, rules }
}

async function getBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}
const chat = (content: string): JsonObject => ({ model: 'test-model', messages: [{ role: 'user', content }] })

test('应用服务监听回环端口，健康检查不返回令牌；模型接口需要认证', async (t) => {
  const { gateway, base } = await setup(t)
  const health = await fetch(base.replace('/v1', '/health'))
  assert.equal(health.status, 200)
  assert.ok(!(await health.text()).includes(gateway.token))
  assert.equal((await fetch(base + '/models')).status, 401)
  assert.equal(
    (await fetch(base + '/models', { headers: { authorization: 'Bearer local-test-token' } })).status,
    200
  )
  const port = gateway.snapshot().settings.port
  await gateway.stop()
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(port, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => probe.close(() => resolve()))
})

test('凭据阻断后，上游收到的请求数严格为零', async (t) => {
  let upstreamRequests = 0
  const { post, gateway, rules } = await setup(t, (_req, res) => {
    upstreamRequests++
    res.end('{}')
  })
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
  const response = await post(chat('password=demo_secret_123'))
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('x-privacy-action'), 'BLOCK')
  assert.ok(!(await response.text()).includes('demo_secret_123'))
  assert.equal(upstreamRequests, 0)
  assert.equal(gateway.snapshot().records[0].status, 'blocked')
})

test('上游只收到替换数据和独立凭据，响应在本机恢复', async (t) => {
  let captured: any
  let headers: IncomingMessage['headers'] = {}
  const { post, gateway } = await setup(t, (req, res) => {
    void getBody(req).then((body) => {
      captured = body
      headers = req.headers
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: body.messages[0].content } }] })
      )
    })
  })
  const response = await post(chat('邮箱 user@example.com，电话 13800138000'), '/chat/completions', {
    'x-private-header': 'do-not-forward'
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-privacy-action'), 'MASK')
  assert.ok(!JSON.stringify(captured).includes('user@example.com'))
  assert.ok(!JSON.stringify(captured).includes('13800138000'))
  assert.equal(headers.authorization, 'Bearer upstream-test-token')
  assert.equal(headers['x-private-header'], undefined)
  const result = await response.json()
  assert.equal(result.choices[0].message.content, '邮箱 user@example.com，电话 13800138000')
  assert.equal(gateway.snapshot().records[0].status, 'completed')
})

test('带浏览器 Origin 的请求即使持有令牌也被拒绝，未知字段不外发', async (t) => {
  let count = 0
  const { post } = await setup(t, (_req, res) => {
    count++
    res.end('{}')
  })
  assert.equal(
    (await post(chat('hello'), '/chat/completions', { origin: 'https://untrusted.example' })).status,
    403
  )
  assert.equal((await post({ ...chat('hello'), metadata: { user: 'private' } })).status, 400)
  assert.equal(count, 0)
})

test('Responses 请求强制 store=false，PII 不发送给上游', async (t) => {
  let captured: any
  const { post } = await setup(t, (req, res) => {
    assert.equal(req.url, '/v1/responses')
    void getBody(req).then((body) => {
      captured = body
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ output: [{ text: body.input }] }))
    })
  })
  const response = await post({ model: 'test-model', input: 'user@example.com', store: true }, '/responses')
  assert.equal(response.status, 200)
  assert.equal(captured.store, false)
  assert.ok(!captured.input.includes('user@example.com'))
  assert.equal((await response.json()).output[0].text, 'user@example.com')
})

test('Anthropic 保留所需协议 Header，Messages 和 count_tokens 均经过检测', async (t) => {
  const paths: string[] = []
  const { post } = await setup(
    t,
    (req, res) => {
      paths.push(req.url!)
      assert.equal(req.headers['x-api-key'], 'upstream-test-token')
      assert.equal(req.headers.authorization, undefined)
      assert.equal(req.headers['anthropic-beta'], 'test-beta')
      void getBody(req).then((body) => {
        assert.ok(!JSON.stringify(body).includes('user@example.com'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({ input_tokens: 4, content: [{ type: 'text', text: body.messages[0].content }] })
        )
      })
    },
    'anthropic'
  )
  for (const endpoint of ['/messages', '/messages/count_tokens']) {
    const response = await post(chat('user@example.com'), endpoint, { 'anthropic-beta': 'test-beta' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).content[0].text, 'user@example.com')
  }
  assert.deepEqual(paths, ['/v1/messages', '/v1/messages/count_tokens'])
})

test('SSE 保持上游事件，不把真实个人信息恢复进流式响应', async (t) => {
  let expected = ''
  const { post, gateway } = await setup(t, (req, res) => {
    void getBody(req).then((body) => {
      expected =
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: body.messages[0].content } }] }) +
        '\n\ndata: [DONE]\n\n'
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(expected.slice(0, 30))
      res.end(expected.slice(30))
    })
  })
  const response = await post({ ...chat('user@example.com'), stream: true })
  assert.equal(response.headers.get('x-privacy-rehydration'), 'disabled-for-stream')
  const content = await response.text()
  assert.equal(content, expected)
  assert.ok(!content.includes('user@example.com'))
  assert.ok(content.includes('⟦EMAIL_'))
  assert.equal(gateway.snapshot().records[0].status, 'completed')
})

test('上游失败不回显原文、凭据或错误正文，记录标为失败', async (t) => {
  const { post, gateway } = await setup(t, (_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end('{"error":"sensitive-provider-diagnostic"}')
  })
  const response = await post(chat('hello'))
  assert.equal(response.status, 401)
  assert.ok(!(await response.text()).includes('sensitive-provider-diagnostic'))
  assert.equal(gateway.snapshot().records[0].status, 'failed')
})

test('拒绝过大请求与不匹配协议，不进行上游请求', async (t) => {
  let calls = 0
  const { post } = await setup(
    t,
    (_req, res) => {
      calls++
      res.end('{}')
    },
    'deepseek'
  )
  assert.equal((await post(chat('a'.repeat(300000)))).status, 413)
  assert.equal((await post({ model: 'test-model', input: 'hello' }, '/responses')).status, 400)
  assert.equal(calls, 0)
})

test('客户端取消流式请求后，上游连接随之关闭', { timeout: 5000 }, async (t) => {
  let closeUpstream!: () => void
  const closed = new Promise<void>((resolve) => {
    closeUpstream = resolve
  })
  const { post } = await setup(t, (_req, res) => {
    res.on('close', closeUpstream)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"choices":[]}\n\n')
  })
  const controller = new AbortController()
  const response = await post({ ...chat('hello'), stream: true }, '/chat/completions', {}, controller.signal)
  const reader = response.body!.getReader()
  await reader.read()
  controller.abort()
  await assert.rejects(() => reader.read())
  await closed
})

test('上游跳转不跟随，超大 JSON 响应被拒绝', async (t) => {
  let mode = 'redirect'
  let calls = 0
  const { post } = await setup(t, (_req, res) => {
    calls++
    if (mode === 'redirect') {
      res.writeHead(307, { location: 'http://127.0.0.1:1/private' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ content: 'a'.repeat(8 * 1024 * 1024 + 1) }))
  })
  assert.equal((await post(chat('hello'))).status, 502)
  assert.equal(calls, 1)
  mode = 'large'
  const response = await post(chat('hello'))
  assert.equal(response.status, 502)
  assert.ok((await response.text()).includes('response_too_large'))
})

test('离线 Demo 的三种协议可用，原文不会出现在记录列表', async (t) => {
  const { post, gateway } = await setup(t)
  for (const endpoint of ['/chat/completions', '/responses', '/messages']) {
    const payload =
      endpoint === '/responses'
        ? { model: 'test-model', input: 'user@example.com' }
        : chat('user@example.com')
    assert.equal((await post(payload, endpoint)).status, 200)
    const stream = await post({ ...payload, stream: true }, endpoint)
    assert.equal(stream.status, 200)
    assert.ok((await stream.text()).includes('data: '))
  }
  assert.ok(!JSON.stringify(gateway.snapshot()).includes('user@example.com'))
  await gateway.demo('password=example_demo_123')
  assert.equal(gateway.snapshot().records[0].source, 'demo')
  assert.equal(gateway.snapshot().records[0].action, 'MASK')
})

test('端口冲突可报告并通过修改设置恢复', async (t) => {
  const blocker = createServer()
  const port = await listen(blocker)
  t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())))
  const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port })
  t.after(() => gateway.stop())
  await assert.rejects(() => gateway.start(), /已被占用/)
  assert.equal(gateway.snapshot().running, false)
  assert.ok(gateway.snapshot().error?.includes('已被占用'))
  const temp = createServer()
  const freePort = await listen(temp)
  await new Promise<void>((resolve) => temp.close(() => resolve()))
  await gateway.saveSettings({ ...DEFAULT_SETTINGS, port: freePort }, '')
  assert.equal(gateway.snapshot().running, true)
  assert.equal(gateway.snapshot().error, undefined)
})

test('原认证入口默认关闭，缺少独立本地通行凭据时拒绝访问', async (t) => {
  const { gateway, base } = await setup(t)
  const url = base.replace('/v1', '/native/codex/responses')
  const request = (headers: Record<string, string>) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer synthetic-client-credential',
        connection: 'close',
        ...headers
      },
      body: JSON.stringify({ model: 'test-model', input: 'hello' })
    })
  assert.equal((await request({})).status, 401)
  assert.equal((await request({ 'x-privacy-gateway-token': gateway.token })).status, 409)
  await gateway.saveSettings(
    { ...gateway.snapshot().settings, provider: 'client', baseUrl: '', model: 'from-client' },
    ''
  )
  assert.equal((await request({ 'x-privacy-gateway-token': 'wrong' })).status, 401)
  assert.equal(
    (await request({ 'x-privacy-gateway-token': gateway.token, origin: 'https://untrusted.example' })).status,
    403
  )
})

test('原认证逐请求转发到固定官方地址，密钥与本地通行头不进入记录', async (t) => {
  const { gateway, base } = await setup(t)
  await gateway.saveSettings(
    {
      ...gateway.snapshot().settings,
      provider: 'client',
      baseUrl: 'https://untrusted.example',
      model: 'from-client'
    },
    'must-not-use'
  )
  const actualFetch = globalThis.fetch
  const captured: {
    url: string
    headers: Record<string, string>
    body: any
    redirect: string | undefined
  }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return actualFetch(url, init)
    captured.push({
      url: String(url),
      headers: init!.headers as Record<string, string>,
      body: JSON.parse(init!.body as string),
      redirect: init?.redirect
    })
    return new Response(JSON.stringify({ content: 'ok' }), {
      headers: { 'content-type': 'application/json' }
    })
  })
  const cases: { path: string; headers: Record<string, string>; target: string }[] = [
    {
      path: '/native/codex/responses',
      headers: {
        authorization: 'Bearer synthetic-chatgpt-credential',
        'chatgpt-account-id': 'synthetic-account'
      },
      target: 'https://chatgpt.com/backend-api/codex/responses'
    },
    {
      path: '/native/codex/responses',
      headers: { authorization: 'Bearer synthetic-openai-key' },
      target: 'https://api.openai.com/v1/responses'
    },
    {
      path: '/native/claude/v1/messages',
      headers: {
        authorization: 'Bearer synthetic-claude-oauth',
        'anthropic-beta': 'oauth-test,future-beta',
        'anthropic-version': '2023-06-01'
      },
      target: 'https://api.anthropic.com/v1/messages'
    },
    {
      path: '/native/claude/v1/messages/count_tokens',
      headers: { 'x-api-key': 'synthetic-anthropic-key', 'anthropic-beta': 'future-beta' },
      target: 'https://api.anthropic.com/v1/messages/count_tokens'
    }
  ]
  for (const entry of cases) {
    const response = await fetch(base.replace('/v1', entry.path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-privacy-gateway-token': gateway.token,
        'x-private-header': 'do-not-forward',
        ...entry.headers
      } as Record<string, string>,
      body: JSON.stringify(
        entry.path.endsWith('responses')
          ? { model: 'test-model', input: 'user@example.com' }
          : chat('user@example.com')
      )
    })
    assert.equal(response.status, 200)
    const upstream = captured.at(-1)!
    assert.equal(upstream.url, entry.target)
    assert.equal(upstream.redirect, 'error')
    for (const [key, value] of Object.entries(entry.headers))
      if (value) assert.equal(upstream.headers[key], value)
    assert.equal(upstream.headers['x-privacy-gateway-token'], undefined)
    assert.equal(upstream.headers['x-private-header'], undefined)
    assert.ok(!JSON.stringify(upstream.body).includes('user@example.com'))
    const record = gateway.records.detail(gateway.snapshot().records[0].id, true)!
    for (const credential of Object.values(entry.headers))
      if (credential) assert.ok(!JSON.stringify(record).includes(credential))
  }
  assert.equal(gateway.snapshot().hasApiKey, false)
  assert.equal(gateway.snapshot().settings.baseUrl, '')
})

test('原认证入口也会阻断敏感正文，拒绝不支持的工具请求', async (t) => {
  const { gateway, base, rules } = await setup(t)
  await gateway.saveSettings(
    { ...gateway.snapshot().settings, provider: 'client', baseUrl: '', model: 'from-client' },
    ''
  )
  const actualFetch = globalThis.fetch
  let sent = 0
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return actualFetch(url, init)
    sent++
    throw new Error('unexpected upstream')
  })
  const post = (body: JsonObject, headers = {}) =>
    fetch(base.replace('/v1', '/native/codex/responses'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-privacy-gateway-token': gateway.token,
        authorization: 'Bearer synthetic-client-credential',
        ...headers
      },
      body: JSON.stringify(body)
    })
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
  assert.equal((await post({ model: 'test-model', input: 'password=example_demo_123' })).status, 403)
  assert.equal(
    (await post({ model: 'test-model', input: 'hello', tools: [{ type: 'function' }] })).status,
    400
  )
  assert.equal(
    (await post({ model: 'test-model', input: 'hello' }, { authorization: 'Bearer apg_local-access-only' }))
      .status,
    401
  )
  assert.equal(sent, 0)
})
