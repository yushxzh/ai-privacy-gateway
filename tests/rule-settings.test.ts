import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NativeInspection } from '../src/gateway/native-inspection'
import { RecordStore } from '../src/gateway/records'
import { RuleSettings } from '../src/privacy/rule-settings'
import { PrivacyPipeline } from '../src/privacy/pipeline'
import { PrivacyGateway } from '../src/gateway/server'
import { DEFAULT_SETTINGS } from '../src/gateway/providers'
import { RULES } from '../src/shared/rules'
import { previewCustomRule } from '../src/privacy/rule-preview'
import type { CustomRuleInput } from '../src/shared/rule-settings'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const custom = (patch: Partial<CustomRuleInput> = {}): CustomRuleInput => ({ name: '项目代号', kind: 'literal',
  pattern: 'PROJECT_ORCHID_0912', ignoreCase: false, enabled: true, action: 'MASK', ...patch })
const pipeline = (rules: RuleSettings) => new PrivacyPipeline(undefined, undefined, undefined, undefined, rules)
const nativeRequest = (text: string) => ({ host: 'www.workbuddy.ai', path: '/synthetic-test', model: 'Auto', stream: true,
  fields: [{ path: ['messages', 0, 'content'], text }] })

test('正文中的 Cookie Token 默认替换，不能把正常分析请求直接阻断', async () => {
  const records = new RecordStore()
  const inspection = new NativeInspection(records)
  const token = 'eyJhbGciOiJkaXIifQ..SYNTHETIC_IV.SYNTHETIC_CIPHERTEXT.SYNTHETIC_TAG'
  try {
    const result = await inspection.inspect({ host: 'www.workbuddy.ai', path: '/synthetic-test', model: 'Auto', stream: true,
      fields: [{ path: ['messages', 0, 'content'], text: `请解释这段命令，不执行：curl https://example.invalid -b 'Admin-Token=${token}'` }] })
    assert.equal(result.action, 'MASK')
    assert.ok(!result.fields[0].text.includes(token))
    assert.ok(result.fields[0].text.includes('Admin-Token='))
    const body = JSON.stringify({ model: 'Auto', messages: [{ role: 'user', content: result.fields[0].text }] })
    assert.equal(inspection.confirm(result.id, body, true).originalsAbsent, true)
    inspection.finish(result.id, 200)
    assert.equal(records.summaries()[0].status, 'completed')
  } finally { inspection.close() }
})

test('内置动作、启停与自定义规则持久保存，编辑和删除不会改变内置定义', t => {
  const dir = mkdtempSync(join(tmpdir(), 'apg-rules-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'rule-settings.json')
  const rules = new RuleSettings(path)
  assert.equal(rules.snapshot().rules.length, 14)
  assert.ok(rules.snapshot().rules.every(rule => rule.enabled && rule.action === 'MASK'))
  rules.setPolicy('jwt', { enabled: true, action: 'BLOCK' }, 0)
  rules.setPolicy('phone-cn', { enabled: false, action: 'MASK' }, 1)
  const id = rules.saveCustom(null, custom(), 2).rules.at(-1)!.id
  rules.saveCustom(id, custom({ kind: 'regex', pattern: 'CASE-[0-9]{4}', ignoreCase: true, name: '案件编号' }), 3)
  let restored = new RuleSettings(path)
  assert.deepEqual(restored.snapshot(), rules.snapshot())
  assert.equal(restored.snapshot().rules.find(rule => rule.id === 'jwt')?.action, 'BLOCK')
  assert.equal(restored.snapshot().rules.find(rule => rule.id === 'phone-cn')?.enabled, false)
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(stored.custom.length, 1)
  assert.equal(Object.keys(stored.overrides).length, 2)
  assert.equal(stored.custom[0].pattern, 'CASE-[0-9]{4}')
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600)
  restored.deleteCustom(id, 4)
  restored = new RuleSettings(path)
  assert.equal(restored.snapshot().rules.length, 14)
  assert.equal(restored.snapshot().rules.find(rule => rule.id === 'jwt')?.action, 'BLOCK')
  assert.throws(() => restored.deleteCustom('jwt', 5), /只能删除/)
})

test('非法配置、过期编辑与磁盘保存失败不会替换有效规则', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'apg-rule-failure-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'rule-settings.json')
  const rules = new RuleSettings(path)
  rules.setPolicy('jwt', { enabled: true, action: 'BLOCK' }, 0)
  const before = readFileSync(path, 'utf8')
  for (const input of [custom({ name: '' }), custom({ kind: 'regex', pattern: '(' }), custom({ pattern: 'x'.repeat(513) })])
    assert.throws(() => rules.saveCustom(null, input, 1))
  assert.throws(() => rules.setPolicy('jwt', { enabled: false, action: 'MASK' }, 0), /发生变化/)
  assert.equal(readFileSync(path, 'utf8'), before)
  rmSync(path); mkdirSync(path)
  assert.throws(() => rules.setPolicy('jwt', { enabled: false, action: 'MASK' }, 1), /保存失败/)
  assert.equal(rules.snapshot().rules.find(rule => rule.id === 'jwt')?.action, 'BLOCK')
  rmSync(path, { recursive: true }); writeFileSync(path, '{invalid config')
  const corrupt = new RuleSettings(path)
  assert.match(corrupt.snapshot().error!, /无法读取/)
  await assert.rejects(() => pipeline(corrupt).process(['plain text']), /无法读取/)
})

test('固定文本保留正则特殊字符，正则与忽略大小写能替换所有匹配', async () => {
  const rules = new RuleSettings()
  const literal = '预算+[内部].(草稿)$'
  rules.saveCustom(null, custom({ pattern: literal }), 0)
  rules.saveCustom(null, custom({ name: '合同编号', kind: 'regex', pattern: 'CASE-[0-9]{4}', ignoreCase: true }), 1)
  const original = `${literal} / ${literal} / CASE-2026 / case-1234 / 普通内容`
  const result = await pipeline(rules).process([original])
  try {
    assert.equal(result.decision.action, 'MASK')
    assert.equal(result.findings.length, 4)
    assert.ok(!result.sanitized[0].includes(literal))
    assert.ok(!result.sanitized[0].toLowerCase().includes('case-'))
    assert.ok(result.sanitized[0].includes('普通内容'))
    assert.deepEqual(result.pseudonymizer.restore(result.sanitized), [original])
  } finally { result.pseudonymizer.clear() }
})

test('重叠范围完整替换；任意阻断规则命中都生效，不受匹配长度和顺序影响', async () => {
  const rules = new RuleSettings()
  rules.saveCustom(null, custom({ name: '前半段', pattern: 'alpha-beta' }), 0)
  const second = rules.saveCustom(null, custom({ name: '后半段', pattern: 'beta-gamma' }), 1).rules.at(-1)!.id
  let result = await pipeline(rules).process(['alpha-beta-gamma'])
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].value, 'alpha-beta-gamma')
  assert.equal(result.ruleMatches.length, 2)
  assert.ok(!result.sanitized[0].includes('gamma'))
  result.pseudonymizer.clear()
  rules.setPolicy(second, { enabled: true, action: 'BLOCK' }, 2)
  result = await pipeline(rules).process(['alpha-beta-gamma'])
  assert.equal(result.decision.action, 'BLOCK')
  result.pseudonymizer.clear()
})

test('关掉规则后停止匹配；已有请求与记录保留自己的规则版本和名称', async () => {
  const rules = new RuleSettings()
  const id = rules.saveCustom(null, custom(), 0).rules.at(-1)!.id
  const records = new RecordStore()
  const native = new NativeInspection(records, rules)
  const first = await native.inspect(nativeRequest('PROJECT_ORCHID_0912'))
  rules.setPolicy(id, { enabled: false, action: 'BLOCK' }, 1)
  const second = await native.inspect(nativeRequest('PROJECT_ORCHID_0912'))
  assert.equal(first.action, 'MASK')
  assert.equal(second.action, 'ALLOW')
  assert.equal(second.fields[0].text, 'PROJECT_ORCHID_0912')
  rules.saveCustom(id, custom({ name: '改名后的规则' }), 2)
  native.confirm(first.id, JSON.stringify({ messages: [{ content: first.fields[0].text }] }), true)
  native.finish(first.id, 200)
  assert.equal(records.detail(first.id, false)?.ruleMatches?.[0].name, '项目代号')
  assert.equal(records.detail(first.id, false)?.rulesRevision, 1)
  native.close()
})

test('复杂正则、空匹配和过多命中有明确上限，不无限挂起', async () => {
  for (const [pattern, text, expected] of [
    ['(a+)+$', 'a'.repeat(10000) + '!', /超时/],
    ['(?=a)', 'abc', /空匹配/],
    ['x', 'x'.repeat(2001), /2,000/]
  ] as const) {
    const rules = new RuleSettings()
    rules.saveCustom(null, custom({ kind: 'regex', pattern }), 0)
    const started = performance.now()
    await assert.rejects(() => pipeline(rules).process([text]), expected)
    assert.ok(performance.now() - started < 1500)
  }
})

test('编辑器预览仅测试未保存的规则，不改当前规则或触发网络请求', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('不能访问网络') })
  const rules = new RuleSettings()
  const before = rules.snapshot()
  const preview = await previewCustomRule(custom(), 'PROJECT_ORCHID_0912 and demo@example.com')
  assert.equal(preview.action, 'MASK')
  assert.ok(!preview.sanitized.includes('PROJECT_ORCHID_0912'))
  assert.ok(preview.sanitized.includes('demo@example.com'))
  assert.deepEqual(rules.snapshot(), before)
})

test('14 条内置规则经真实 HTTP 验证：默认替换、可改阻断，原生入口同步使用设置', async t => {
  const received: { body: any; auth?: string }[] = []
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    received.push({ body: JSON.parse(Buffer.concat(chunks).toString()), auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices":[{"message":{"content":"ok"}}]}')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())))
  const address = upstream.address(); assert.ok(address && typeof address !== 'string')
  const settings = { ...DEFAULT_SETTINGS, port: 0, provider: 'compatible' as const,
    baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic' }
  const rules = new RuleSettings()
  const gateway = new PrivacyGateway(settings, undefined, rules)
  await gateway.start(); await gateway.saveSettings(gateway.snapshot().settings, 'synthetic-original-auth')
  t.after(() => gateway.stop())
  const native = new NativeInspection(gateway.records, rules); t.after(() => native.close())
  const post = (text: string) => fetch(gateway.snapshot().baseUrl + '/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer ' + gateway.token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: text }] })
  })
  for (const rule of RULES) {
    const sample = rule.samples.find(sample => sample.hit)!.input
    const before = received.length
    let response = await post(sample); await response.arrayBuffer()
    assert.equal(response.status, 200, rule.id)
    assert.equal(response.headers.get('x-privacy-action'), 'MASK', rule.id)
    assert.equal(received.length, before + 1)
    assert.equal(received.at(-1)?.auth, 'Bearer synthetic-original-auth')
    const expected = await gateway.inspectRules(sample)
    for (const hit of expected.findings) assert.ok(!received.at(-1)?.body.messages[0].content.includes(sample.slice(hit.start, hit.end)), rule.id)
    rules.setPolicy(rule.id, { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
    response = await post(sample); await response.arrayBuffer()
    assert.equal(response.status, 403, rule.id)
    assert.equal(received.length, before + 1, rule.id)
    const inspected = await native.inspect(nativeRequest(sample))
    assert.equal(inspected.action, 'BLOCK', rule.id)
    assert.throws(() => native.confirm(inspected.id, '{}', true))
    rules.setPolicy(rule.id, { enabled: false, action: 'BLOCK' }, rules.snapshot().revision)
    const disabled = await gateway.inspectRules(sample)
    assert.ok(!disabled.findings.some(hit => hit.ruleId === rule.id), rule.id)
    rules.setPolicy(rule.id, { enabled: true, action: 'MASK' }, rules.snapshot().revision)
  }
  const id = rules.saveCustom(null, custom(), rules.snapshot().revision).rules.at(-1)!.id
  let response = await post('PROJECT_ORCHID_0912'); await response.arrayBuffer()
  assert.equal(response.status, 200)
  assert.ok(!received.at(-1)?.body.messages[0].content.includes('PROJECT_ORCHID_0912'))
  const nativeMasked = await native.inspect(nativeRequest('PROJECT_ORCHID_0912'))
  assert.equal(nativeMasked.action, 'MASK')
  rules.setPolicy(id, { enabled: true, action: 'BLOCK' }, rules.snapshot().revision)
  response = await post('PROJECT_ORCHID_0912'); await response.arrayBuffer()
  assert.equal(response.status, 403)
  assert.equal((await native.inspect(nativeRequest('PROJECT_ORCHID_0912'))).action, 'BLOCK')
})
