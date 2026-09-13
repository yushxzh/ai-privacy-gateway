import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { prepareUninstall } from '../src/main/uninstall'
import { waitForNativeProxyExit } from '../src/main/native-runtime'

test('卸载先恢复全部模型和代理，撤销证书后重开客户端，最后清除备份', async () => {
  const events: string[] = []
  const config = { restore() { events.push('proxy'); return 'restored' as const }, finishRestore() { events.push('finish') } }
  const models = { async restoreAll() { events.push('models') } }
  const certificate = { async remove() { events.push('certificate') } }
  const client = { async close() { events.push('close'); return true }, async open() { events.push('open') } }
  await prepareUninstall(config, models, certificate, client)
  assert.deepEqual(events, ['close', 'models', 'proxy', 'certificate', 'open', 'finish'])
})

test('卸载撤销失败仍重开原客户端并保留备份；客户端拒绝关闭时不修改连接', async () => {
  const events: string[] = []
  const config = { restore() { events.push('proxy'); return 'restored' as const }, finishRestore() { events.push('finish') } }
  const models = { async restoreAll() { events.push('models') } }
  const certificate = { async remove() { events.push('certificate'); throw new Error('synthetic denied') } }
  const client = { async close() { events.push('close'); return true }, async open() { events.push('open') } }
  await assert.rejects(prepareUninstall(config, models, certificate, client), /synthetic denied/)
  assert.deepEqual(events, ['close', 'models', 'proxy', 'certificate', 'open'])
  events.length = 0
  client.close = async () => { throw new Error('synthetic busy') }
  await assert.rejects(prepareUninstall(config, models, certificate, client), /synthetic busy/)
  assert.deepEqual(events, [])
})

test('等待旧代理释放真实端口后才允许清理', async t => {
  const server = createServer(socket => socket.end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close() })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  let released = false
  const release = setTimeout(() => server.close(() => { released = true }), 300)
  t.after(() => clearTimeout(release))
  await waitForNativeProxyExit(address.port)
  assert.equal(released, true)
  await waitForNativeProxyExit(address.port)
})
