import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { PrivacyGateway } from '../src/gateway/server'
import { DEFAULT_SETTINGS } from '../src/gateway/providers'
import { RULES } from '../src/shared/rules'
import { DETECTOR_RULE_IDS } from '../src/privacy/detectors'
import vectors from './fixtures/bip39-vectors.json'

const gateway = new PrivacyGateway()

test('独立参考实现的十种语言 BIP39 向量均被整段识别，Unicode 组合形式不影响检测', async () => {
  for (const [language, cases] of Object.entries(vectors)) {
    for (const vector of cases) {
      for (const phrase of new Set([vector.phrase, vector.phrase.normalize('NFC')])) {
        const input = 'public fixture: ' + phrase + '\nend of fixture'
        const result = await gateway.inspectRules(input)
        assert.equal(result.action, 'MASK', language)
        assert.ok(result.findings.some(hit => hit.ruleId === 'mnemonic-bip39'
          && input.slice(hit.start, hit.end) === phrase), language + ':' + vector.entropy.length)
      }
    }
  }
})

test('每个实际检测器都在可点击目录中，并且具有命中与不命中的可运行样例', () => {
  assert.equal(RULES.length, new Set(RULES.map(rule => rule.id)).size)
  assert.deepEqual(new Set(DETECTOR_RULE_IDS), new Set(RULES.map(rule => rule.id)))
  for (const rule of RULES) {
    assert.ok(rule.samples.some(sample => sample.hit), rule.id)
    assert.ok(rule.samples.some(sample => !sample.hit), rule.id)
  }
})
for (const rule of RULES) {
  for (const sample of rule.samples) {
    test(`${rule.name} / ${sample.name}`, async () => {
      const result = await gateway.inspectRules(sample.input)
      assert.equal(result.action, sample.action)
      assert.equal(result.findings.some(hit => hit.ruleId === rule.id), sample.hit)
      for (const hit of result.findings) {
        assert.ok(hit.start >= 0 && hit.end <= sample.input.length && hit.end > hit.start)
        assert.ok(!('value' in hit))
      }
      if (sample.hit) assert.notEqual(result.sanitized, sample.input)
      else assert.equal(result.sanitized, sample.input)
    })
  }
}

test('规则验证只在本地运行；同一引擎用于批量样例、任意输入和网关正文', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('规则验证不能访问网络') })
  const result = await gateway.verifyRuleSamples()
  assert.equal(result.length, RULES.reduce((sum, rule) => sum + rule.samples.length, 0))
  assert.ok(result.every(item => item.passed))
  assert.equal(gateway.snapshot().records.length, 0)
  assert.equal(gateway.snapshot().counters.total, 0)
  await assert.rejects(() => gateway.inspectRules(''))
  await assert.rejects(() => gateway.inspectRules('x'.repeat(12001)))
  const mixed = await gateway.inspectRules('用户名：demo_account\n密码：synthetic_password\n联系 demo@example.com')
  assert.equal(mixed.action, 'MASK')
  assert.deepEqual(new Set(mixed.findings.map(hit => hit.category)), new Set(['ACCOUNT', 'PASSWORD', 'EMAIL']))
})

test('所有规则样例经过真实 HTTP：敏感原文不外发，默认只外发代号，反例放行', async t => {
  const received: any[] = []
  const upstream = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    received.push(body)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())))
  const upstreamPort = (upstream.address() as { port: number }).port
  const live = new PrivacyGateway({ ...DEFAULT_SETTINGS, port: 0, provider: 'compatible',
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, model: 'test-model' })
  await live.start(); t.after(() => live.stop())
  for (const rule of RULES) {
    for (const sample of rule.samples) {
      const before = received.length
      const response = await fetch(live.snapshot().baseUrl + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + live.token },
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: sample.input }] })
      })
      await response.arrayBuffer()
      assert.equal(response.status, sample.action === 'BLOCK' ? 403 : 200, rule.id + ':' + sample.name)
      assert.equal(response.headers.get('x-privacy-action'), sample.action)
      if (sample.action === 'BLOCK') assert.equal(received.length, before)
      else {
        assert.equal(received.length, before + 1)
        const actual = received.at(-1).messages[0].content
        if (sample.action === 'MASK') {
          assert.notEqual(actual, sample.input)
          const expected = await live.inspectRules(sample.input)
          for (const hit of expected.findings) assert.ok(!actual.includes(sample.input.slice(hit.start, hit.end)))
        } else assert.equal(actual, sample.input)
      }
    }
  }
})
