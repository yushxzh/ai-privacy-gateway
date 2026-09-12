import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { NativeBridge } from '../src/gateway/native-bridge'
import { RecordStore } from '../src/gateway/records'
import { RuleSettings } from '../src/privacy/rule-settings'

test('mitmproxy 压缩正文经过真实本地检查入口，认证与工具结构保留，凭据不确认外发', async t => {
  const python = process.env.APG_TEST_PYTHON
  assert.ok(python, '请通过 APG_TEST_PYTHON 指定已安装 mitmproxy 的 Python。')
  const records = new RecordStore()
  const rules = new RuleSettings()
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, 0)
  const bridge = new NativeBridge(records, rules)
  await bridge.start()
  t.after(() => bridge.stop())
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(python, [resolve('tests/native-addon.py')], { env: { ...process.env,
      APG_NATIVE_BRIDGE_URL: bridge.url, APG_NATIVE_BRIDGE_TOKEN: bridge.token, PYTHONDONTWRITEBYTECODE: '1' } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveOutput(stdout) : reject(new Error(stderr)))
  })
  await bridge.waitUntilReady()
  const result = JSON.parse(output)
  assert.equal(result.success, true)
  const record = records.detail(result.id, true)
  assert.equal(record?.status, 'completed')
  assert.equal(record?.outbound?.sha256, result.sha256)
  assert.equal(record?.provider, 'client')
  assert.equal(record?.upstreamHost, 'www.workbuddy.ai')
  assert.deepEqual(records.counts(), { total: 2, masked: 1, blocked: 1, allowed: 0 })
  assert.equal(JSON.stringify(records.summaries()).includes('synthetic-login'), false)
  assert.equal(record?.original?.includes('synthetic-login'), false)
})
