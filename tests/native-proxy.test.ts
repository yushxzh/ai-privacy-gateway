import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { NativeProxy } from '../src/main/native-proxy'
import { RecordStore } from '../src/gateway/records'
import { NativeBridge } from '../src/gateway/native-bridge'
import { spawn } from 'node:child_process'

test('真实 TLS 进程报告就绪后才标记运行，停用后进程结束', async t => {
  const python = process.env.APG_TEST_PYTHON
  assert.ok(python)
  const ca = await mkdtemp(join(tmpdir(), 'apg-tls-lifecycle-'))
  t.after(() => rm(ca, { recursive: true, force: true }))
  const proxy = new NativeProxy(new RecordStore(),process.env.APG_TEST_MITMDUMP || join(dirname(python),'mitmdump'),resolve('src/https/workbuddy.py'),ca,0)
  t.after(() => proxy.stop())
  await proxy.start()
  assert.equal(proxy.running,true)
  await proxy.stop()
  assert.equal(proxy.running,false)
})

test('端口占用或运行时不存在时不能显示 HTTPS 保护已启动', async t => {
  const python = process.env.APG_TEST_PYTHON
  assert.ok(python)
  const ca = await mkdtemp(join(tmpdir(), 'apg-tls-failure-'))
  t.after(() => rm(ca, { recursive: true, force: true }))
  const server = createServer(socket => socket.end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  for (const binary of [process.env.APG_TEST_MITMDUMP || join(dirname(python),'mitmdump'),join(ca,'missing-runtime')]) {
    const proxy: NativeProxy = new NativeProxy(new RecordStore(),binary,resolve('src/https/workbuddy.py'),ca,address.port)
    await assert.rejects(proxy.start())
    assert.equal(proxy.running,false)
    await proxy.stop()
  }
})

test('桌面崩溃后立即重开，等待旧 TLS 进程退出并恢复同一端口', async t => {
  const python = process.env.APG_TEST_PYTHON
  assert.ok(python)
  const ca = await mkdtemp(join(tmpdir(), 'apg-orphan-check-'))
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const executable = process.env.APG_TEST_MITMDUMP || join(dirname(python), 'mitmdump')
  const bridge = new NativeBridge(new RecordStore())
  await bridge.start()
  const child = spawn(executable,
    ['--listen-host', '127.0.0.1', '--listen-port', String(port), '--set', `confdir=${ca}`, '-s', resolve('src/https/workbuddy.py')],
    { stdio: 'ignore', env: { ...process.env, APG_NATIVE_BRIDGE_URL: bridge.url, APG_NATIVE_BRIDGE_TOKEN: bridge.token } })
  const exited = new Promise<void>((resolveExit, reject) => { child.once('exit', () => resolveExit()); child.once('error', reject) })
  const replacement = new NativeProxy(new RecordStore(), executable, resolve('src/https/workbuddy.py'), ca, port)
  t.after(async () => {
    await replacement.stop()
    if (child.exitCode === null) child.kill()
    await exited
    await bridge.stop()
    await rm(ca, { recursive: true, force: true })
  })
  await bridge.waitUntilReady()
  await bridge.stop()
  assert.equal(child.exitCode, null)
  await replacement.start()
  assert.equal(replacement.running, true)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('孤立 TLS 进程未退出。')), 12000) })])
  } finally { clearTimeout(timer) }
  assert.equal(child.exitCode, 0)
})
