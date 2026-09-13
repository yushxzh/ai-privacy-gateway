import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { NativeInspection, type NativeRequest } from '../src/gateway/native-inspection'
import { NativeBridge } from '../src/gateway/native-bridge'
import { RecordStore } from '../src/gateway/records'
import { RuleSettings } from '../src/privacy/rule-settings'

const request = (text: string): NativeRequest => ({ host: 'www.workbuddy.ai', path: '/synthetic-test',
  model: 'Auto', stream: true, fields: [{ path: ['messages', 0, 'content'], text }] })

test('原生检查复用规则，核对最终正文与认证，记录实际摘要和上游结果', async () => {
  const records = new RecordStore()
  const service = new NativeInspection(records)
  const result = await service.inspect(request('apg.native@example.com 13800138000'))
  assert.equal(result.action, 'MASK')
  const body = JSON.stringify({ model: 'native-model', messages: [{ role: 'user', content: result.fields[0].text }], tools: [] })
  const outbound = service.confirm(result.id, body, true)
  assert.equal(outbound.sha256, createHash('sha256').update(body).digest('hex'))
  assert.deepEqual(records.summaries()[0].ruleIds, ['email', 'phone-cn'])
  assert.equal(records.detail(result.id, false)?.original, undefined)
  service.finish(result.id, 200)
  assert.equal(records.summaries()[0].status, 'completed')
  assert.equal(records.summaries()[0].transport, 'https-proxy')
  assert.equal(records.summaries()[0].outbound?.originalsAbsent, true)
})

test('敏感原文藏在另一个字段、发送值不一致或认证变化时必须拒绝', async () => {
  for (const kind of ['duplicate', 'unchanged', 'auth']) {
    const store = new RecordStore()
    const service = new NativeInspection(store)
    const result = await service.inspect(request('apg.native@example.com'))
    const body = { messages: [{ content: kind === 'unchanged' ? 'apg.native@example.com' : result.fields[0].text }],
      metadata: kind === 'duplicate' ? { copy: 'apg.native@example.com' } : {} }
    assert.throws(() => service.confirm(result.id, JSON.stringify(body), kind !== 'auth'))
    service.finish(result.id, 200)
    assert.equal(store.summaries()[0].status, 'failed')
    assert.equal(store.summaries()[0].outbound, undefined)
  }
})

test('凭据被阻断，不能确认发送；只收到上游成功也不能冒充已完成', async () => {
  const store = new RecordStore()
  const rules = new RuleSettings()
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, 0)
  const service = new NativeInspection(store, rules)
  const blocked = await service.inspect(request('password=synthetic-private-0912'))
  assert.equal(blocked.action, 'BLOCK')
  assert.throws(() => service.confirm(blocked.id, '{}', true))
  const pending = await service.inspect(request('hello'))
  service.finish(pending.id, 200)
  assert.equal(store.summaries()[0].status, 'failed')
  assert.equal(store.summaries()[1].status, 'blocked')
})

test('独立检查入口拒绝浏览器和无令牌调用，正常请求记录在同一 App 存储中', async t => {
  const store = new RecordStore()
  const bridge = new NativeBridge(store)
  await bridge.start()
  t.after(() => bridge.stop())
  const post = (headers: Record<string, string>) => fetch(bridge.url + '/inspect', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(request('hello'))
  })
  assert.equal((await post({})).status, 403)
  assert.equal((await post({ authorization: 'Bearer ' + bridge.token, origin: 'https://example.com' })).status, 403)
  const response = await post({ authorization: 'Bearer ' + bridge.token })
  assert.equal(response.status, 200)
  assert.equal(store.counts().total, 1)
  assert.equal(JSON.stringify(store.summaries()).includes(bridge.token), false)
})

test('未检查与格式失败记录不计为规则放行或规则阻断，不保存原文', () => {
  const records = new RecordStore()
  const service = new NativeInspection(records)
  service.unchecked('unsupported')
  service.unchecked('outside-scope')
  service.unchecked('check-failed')
  assert.deepEqual(records.counts(), { total: 3, masked: 0, blocked: 0, allowed: 0, unchecked: 3 })
  for (const summary of records.summaries()) {
    assert.equal(summary.outbound, undefined)
    assert.equal(records.detail(summary.id, true)?.original, '')
    assert.equal(records.detail(summary.id, true)?.sanitized, '')
  }
  records.clear()
  assert.equal(records.counts().unchecked, 0)
})

test('大量范围外流量不挤出在途模型请求，累计计数仍包含每次观察', async () => {
  const records = new RecordStore()
  const service = new NativeInspection(records)
  const pending = await service.inspect(request('hello'))
  for (let i = 0; i < 200; i++) service.unchecked('outside-scope')
  assert.equal(records.summaries().length, 21)
  assert.equal(records.counts().total, 201)
  assert.equal(records.counts().unchecked, 200)
  assert.equal(records.detail(pending.id, false)?.status, 'pending')
  service.close()
  assert.equal(records.detail(pending.id, false)?.status, 'failed')
})
