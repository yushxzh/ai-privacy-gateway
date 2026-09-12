import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { PrivacyPipeline } from '../src/privacy/pipeline'
import { prepareRequest } from '../src/gateway/protocol'
import { RecordStore } from '../src/gateway/records'
import { validateSettings, DEFAULT_SETTINGS } from '../src/gateway/providers'
import { generateGuide } from '../src/shared/integrations'
import type { JsonObject, RecordSummary } from '../src/shared/types'

test('单请求重复实体使用相同代号，映射按请求隔离且可清理', async () => {
  const pipeline = new PrivacyPipeline()
  const first = await pipeline.process([
    '发送到 user@example.com',
    '再次联系 user@example.com，手机号 13800138000'
  ])
  assert.equal(first.decision.action, 'MASK')
  assert.equal(first.sanitized[0].match(/⟦[^⟧]+⟧/)![0], first.sanitized[1].match(/⟦[^⟧]+⟧/)![0])
  assert.deepEqual(first.pseudonymizer.restore(first.sanitized), [
    '发送到 user@example.com',
    '再次联系 user@example.com，手机号 13800138000'
  ])
  const second = await pipeline.process(['发送到 user@example.com'])
  assert.notEqual(first.sanitized[0], second.sanitized[0])
  assert.equal(second.pseudonymizer.restore(first.sanitized[0]), first.sanitized[0])
  first.pseudonymizer.clear()
  assert.equal(first.pseudonymizer.restore(first.sanitized[0]), first.sanitized[0])
  second.pseudonymizer.clear()
})

test('代号恢复设容量限制，避免上游重复代号放大内存', async () => {
  const result = await new PrivacyPipeline().process(['a'.repeat(64) + '@' + 'b'.repeat(200) + '.example'])
  const alias = result.sanitized[0]
  assert.equal(result.decision.action, 'MASK')
  assert.throws(() => result.pseudonymizer.restore(alias.repeat(40000)), /内存限制/)
  result.pseudonymizer.clear()
})

test('凭据优先于 PII，重叠检测不会泄露连接密码', async () => {
  const result = await new PrivacyPipeline().process([
    'mongodb://user:pass@example.com:27017/db，password=demo_secret_123'
  ])
  assert.equal(result.decision.action, 'MASK')
  assert.deepEqual(new Set(result.findings.map((f) => f.category)), new Set(['CREDENTIAL', 'PASSWORD']))
  assert.ok(!result.sanitized[0].includes('user:pass'))
  assert.ok(!result.sanitized[0].includes('demo_secret_123'))
  result.pseudonymizer.clear()
})

test('API Key、私钥、密码默认替换；普通代码保持放行', async () => {
  for (const text of [
    'sk-proj-abcdefghijklmnopqrstuvwx',
    '-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----',
    'password="demo_password"'
  ]) {
    const result = await new PrivacyPipeline().process([text])
    assert.equal(result.decision.action, 'MASK')
    result.pseudonymizer.clear()
  }
  const result = await new PrivacyPipeline().process([
    'const total = prices.reduce((sum, price) => sum + price, 0)'
  ])
  assert.equal(result.decision.action, 'ALLOW')
  result.pseudonymizer.clear()
})

test('Responses 强制关闭远端存储，文本块和 instructions 都经过扫描', async () => {
  const input: JsonObject = {
    model: 'test',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'user@example.com' }] }],
    instructions: '联系 13800138000',
    store: true
  }
  const prepared = prepareRequest(input, 'responses')
  const result = await new PrivacyPipeline().process(prepared.texts)
  const sanitized = prepared.apply(result.sanitized)
  assert.equal(sanitized.store, false)
  assert.ok(!JSON.stringify(sanitized).includes('user@example.com'))
  assert.ok(!JSON.stringify(sanitized).includes('13800138000'))
  assert.equal(input.store, true)
  result.pseudonymizer.clear()
})

test('无法扫描的字段、工具调用、多模态和隐藏会话引用明确拒绝', () => {
  const extras: JsonObject[] = [
    { tools: [] },
    { metadata: { customer: 'private' } },
    { previous_response_id: 'resp_old' },
    { background: true },
    { conversation: 'old' },
    { input: [{ type: 'input_image', image_url: 'data:image/png;base64,private' }] }
  ]
  for (const extra of extras) {
    assert.throws(() => prepareRequest({ model: 'test', input: 'hello', ...extra }, 'responses'))
  }
  assert.throws(() =>
    prepareRequest({ model: 'test', messages: [{ role: 'tool', content: 'private' }] }, 'chat/completions')
  )
  assert.throws(() =>
    prepareRequest(
      { model: 'test', messages: [{ role: 'user', content: [{ type: 'image', source: 'private' }] }] },
      'messages'
    )
  )
  assert.throws(() =>
    prepareRequest({ model: 'test', messages: [{ role: 'user', content: 'ok' }], stream: 'true' }, 'messages')
  )
})

test('上游 URL 必须是 HTTPS 或回环 HTTP，并防止递归配置', () => {
  const settings = { ...DEFAULT_SETTINGS, provider: 'openai' as const, model: 'test' }
  for (const baseUrl of [
    'http://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?key=x',
    'http://127.0.0.1:8787/v1'
  ]) {
    assert.throws(() => validateSettings({ ...settings, baseUrl }))
  }
  assert.equal(
    validateSettings({ ...settings, baseUrl: 'http://127.0.0.1:11434/v1/' }).baseUrl,
    'http://127.0.0.1:11434/v1'
  )
})

test('记录限制数量和原文可见性，清空后旧请求不能重新写回', () => {
  const store = new RecordStore()
  const base: RecordSummary = {
    id: 'r0',
    time: '',
    endpoint: '',
    model: 'test',
    provider: 'demo',
    action: 'MASK',
    categories: ['EMAIL'],
    findings: 1,
    status: 'pending',
    durationMs: 0,
    source: 'api',
    stream: false
  }
  const generation = store.add(base, 'local raw', 'sanitized')
  assert.ok(!JSON.stringify(store.summaries()).includes('local raw'))
  assert.equal(store.detail('r0', false)?.original, undefined)
  assert.equal(store.detail('r0', true)?.original, 'local raw')
  for (let i = 1; i <= 110; i++) store.add({ ...base, id: 'r' + i },
    'request start\n' + 'x'.repeat(25000) + '\nlatest@example.com',
    'request start\n' + 'x'.repeat(25000) + '\n⟦EMAIL_TEST_1⟧')
  assert.equal(store.summaries().length, 100)
  assert.equal(store.detail('r110', true)?.truncated, true)
  assert.equal(store.detail('r110', true)?.original?.length, 24000)
  assert.ok(store.detail('r110', true)?.original?.startsWith('request start'))
  assert.ok(store.detail('r110', true)?.original?.endsWith('latest@example.com'))
  assert.ok(store.detail('r110', true)?.sanitized.endsWith('⟦EMAIL_TEST_1⟧'))
  assert.ok(!store.detail('r110', true)?.sanitized.includes('latest@example.com'))
  store.clear()
  store.update('r0', generation, { status: 'completed' })
  assert.equal(store.summaries().length, 0)
  assert.equal(store.counts().total, 0)
})

test('接入命令保留原认证，本地通行凭据放入独立 Header', () => {
  const settings = { ...DEFAULT_SETTINGS, port: 9999 }
  const token = 'local-test-token'
  for (const shell of ['bash', 'powershell'] as const) {
    const codex = generateGuide('codex', shell, settings, token)
    assert.ok(codex.code.includes('127.0.0.1:9999/native/codex'))
    assert.ok(codex.code.includes('wire_api="responses"'))
    assert.ok(codex.code.includes('requires_openai_auth=true'))
    assert.ok(codex.code.includes('X-Privacy-Gateway-Token'))
    assert.ok(!codex.code.includes('.env_key='))
    assert.ok(!codex.code.includes('--model'))
    const claude = generateGuide('claude', shell, settings, token)
    assert.ok(claude.code.includes('127.0.0.1:9999/native/claude'))
    assert.ok(claude.code.includes('ANTHROPIC_CUSTOM_HEADERS'))
    assert.ok(!claude.code.includes('ANTHROPIC_AUTH_TOKEN'))
    assert.ok(!claude.code.includes('ANTHROPIC_API_KEY'))
    assert.ok(!claude.code.includes('--model'))
  }
})


test('Bash 与 Zsh 生成命令保留原认证和自定义 Header，重复执行不累积本地 Header', { skip: process.platform !== 'darwin' }, () => {
  const guide = generateGuide('claude', 'bash', DEFAULT_SETTINGS, 'synthetic-local-access')
  const script = 'claude() { printf "%s" "$ANTHROPIC_CUSTOM_HEADERS"; };\n' + guide.code
  for (const shell of ['/bin/bash', '/bin/zsh']) {
    const environment = { PATH: '/usr/bin:/bin', ANTHROPIC_AUTH_TOKEN: 'synthetic-original-auth', ANTHROPIC_API_KEY: 'synthetic-original-key', ANTHROPIC_CUSTOM_HEADERS: 'X-Custom: preserved' }
    const once = execFileSync(shell, ['-c', script], { env: environment, encoding: 'utf8' })
    assert.equal(once, 'X-Custom: preserved\nX-Privacy-Gateway-Token: synthetic-local-access')
    const twice = execFileSync(shell, ['-c', script + '\n[ "$ANTHROPIC_AUTH_TOKEN" = synthetic-original-auth ] && [ "$ANTHROPIC_API_KEY" = synthetic-original-key ]'], { env: { ...environment, ANTHROPIC_CUSTOM_HEADERS: once }, encoding: 'utf8' })
    assert.equal(twice, once)
    const codex = generateGuide('codex', 'bash', DEFAULT_SETTINGS, 'synthetic-local-access')
    const args = execFileSync(shell, ['-c', 'codex() { printf "%s\\n" "$@"; };\n' + codex.code], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
    assert.ok(args.includes('requires_openai_auth=true'))
    assert.ok(args.includes('env_http_headers={"X-Privacy-Gateway-Token"="PRIVACY_GATEWAY_TOKEN"}'))
  }
})
