import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkBuddyProxySettings, WORKBUDDY_PROXY } from '../src/main/workbuddy-proxy-settings'
import { WorkBuddyProtection } from '../src/main/protection'
import { nativeExecutable } from '../src/main/native-runtime'
import { macWorkBuddyPath } from '../src/main/workbuddy-process'
import type { RecordSummary } from '../src/shared/types'

function setup(t: { after(fn: () => void): void }, original: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-protection-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'settings.json')
  writeFileSync(path, JSON.stringify(original))
  const config = new WorkBuddyProxySettings(path, join(dir, 'backup.json'))
  const read = () => JSON.parse(readFileSync(path, 'utf8'))
  const events: string[] = []
  let running = true, trusted = true, failOpen = 0, failClose = false, failStart = false, installs = true
  const proxy = { running: false,
    async start() { events.push('start'); if (failStart) throw new Error('端口占用。'); this.running = true },
    async stop() { events.push('stop'); this.running = false } }
  const services = { proxy, client: {
    async executable() { return '/synthetic/WorkBuddy' },
    async close() { events.push('close'); if (failClose) throw new Error('请先关闭 WorkBuddy。'); const result = running; running = false; return result },
    async open() { events.push('open'); if (failOpen > 0) { failOpen--; throw new Error('启动失败。') }; running = true }
  }, async checkCertificate() { events.push('trust'); return trusted },
  async installCertificate() { events.push('install'); if (!installs) throw new Error('授权取消。'); trusted = true } }
  const protection = new WorkBuddyProtection(config, services, true)
  return { config, path, read, events, proxy, protection, services,
    set: (value: { running?: boolean; trusted?: boolean; failOpen?: number; failClose?: boolean; failStart?: boolean; installs?: boolean }) => {
      running = value.running ?? running; trusted = value.trusted ?? trusted; failOpen = value.failOpen ?? failOpen
      failClose = value.failClose ?? failClose; failStart = value.failStart ?? failStart; installs = value.installs ?? installs
    } }
}

test('开启保存原代理，认证及无关设置不变，恢复保留后来的无关改动', async t => {
  const original = { 'http.proxy': 'http://127.0.0.1:9988', 'http.proxySupport': 'override', language: 'zh', auth: 'synthetic-only' }
  const f = setup(t, original)
  await f.protection.initialize()
  assert.equal((await f.protection.enable()).state, 'configured')
  assert.deepEqual(f.events, ['start', 'trust', 'close', 'open'])
  assert.deepEqual(f.read(), { ...original, 'http.proxy': WORKBUDDY_PROXY })
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(f.config.backupPath, 'utf8'))).sort(), ['applied', 'original', 'schema'])
  assert.equal(readFileSync(f.config.backupPath, 'utf8').includes('auth'), false)
  writeFileSync(f.path, JSON.stringify({ ...f.read(), theme: 'light' }))
  await f.protection.disable()
  assert.deepEqual(f.read(), { ...original, theme: 'light' })
  assert.equal(f.config.backup(), undefined)
  assert.deepEqual(f.events.slice(-3), ['close', 'open', 'stop'])
})

test('原来没有代理字段时恢复会删除新增字段，多次开启不覆盖初始备份', async t => {
  const f = setup(t, { language: 'zh' })
  await f.protection.enable(); await f.protection.enable(); await f.protection.disable()
  assert.deepEqual(f.read(), { language: 'zh' })
})

test('旧版手动接入可以接管，恢复为直接连接', async t => {
  const f = setup(t, { 'http.proxy': WORKBUDDY_PROXY, 'http.proxySupport': 'override' })
  await f.protection.enable(); await f.protection.disable()
  assert.deepEqual(f.read(), { 'http.proxy': '', 'http.proxySupport': 'off' })
})

test('恢复不覆盖用户后来选择的另一代理', async t => {
  const f = setup(t)
  await f.protection.enable()
  const changed = { 'http.proxy': 'http://127.0.0.1:8899', 'http.proxySupport': 'override', fontSize: 15 }
  writeFileSync(f.path, JSON.stringify(changed))
  await f.protection.disable()
  assert.deepEqual(f.read(), changed)
  assert.equal(f.protection.snapshot().message, '已保留后来修改的代理设置。')
})

test('端口不可用或证书授权取消时不改 WorkBuddy 配置', async t => {
  for (const options of [{ failStart: true }, { trusted: false, installs: false }]) {
    const f = setup(t, { language: 'zh' }); f.set(options)
    await assert.rejects(f.protection.enable())
    assert.deepEqual(f.read(), { language: 'zh' })
    assert.equal(f.config.backup(), undefined)
    assert.equal(f.events.includes('close'), false)
    assert.equal(f.proxy.running, false)
  }
})

test('缺少证书时完成授权后才修改代理，已受信任时不重复安装', async t => {
  const f = setup(t); f.set({ trusted: false })
  await f.protection.enable()
  assert.deepEqual(f.events, ['start', 'trust', 'install', 'trust', 'close', 'open'])
  await f.protection.disable(); await f.protection.enable()
  assert.equal(f.events.filter(e => e === 'install').length, 1)
})

test('客户端拒绝退出时不强杀、不修改配置', async t => {
  const f = setup(t); f.set({ failClose: true })
  await assert.rejects(f.protection.enable(), /请先关闭/)
  assert.deepEqual(f.read(), {})
  assert.equal(f.config.backup(), undefined)
})

test('首次重启失败会恢复原设置并重新打开，失败状态不冒充已连接', async t => {
  const f = setup(t, { 'http.proxySupport': 'on' }); f.set({ failOpen: 1 })
  await assert.rejects(f.protection.enable(), /启动失败/)
  assert.deepEqual(f.read(), { 'http.proxySupport': 'on' })
  assert.equal(f.config.backup(), undefined)
  assert.equal(f.proxy.running, false)
  assert.equal(f.protection.snapshot().state, 'error')
})

test('回滚也失败时保留恢复资料和代理，之后可重试恢复', async t => {
  const f = setup(t); f.set({ failOpen: 2 })
  await assert.rejects(f.protection.enable(), /恢复资料与代理已保留/)
  assert.ok(f.config.backup())
  assert.equal(f.proxy.running, true)
  assert.equal(f.protection.snapshot().managed, true)
  await f.protection.disable()
  assert.deepEqual(f.read(), {})
  assert.equal(f.config.backup(), undefined)
  assert.equal(f.proxy.running, false)
})

test('停止时客户端拒绝退出会保留可用代理和原恢复资料', async t => {
  const f = setup(t)
  await f.protection.enable(); f.set({ failClose: true })
  await assert.rejects(f.protection.disable(), /恢复尚未完成/)
  assert.equal(f.proxy.running, true)
  assert.equal(f.config.isConnected(), true)
  assert.ok(f.config.backup())
})

test('重开网关恢复上次连接，但不重启客户端或重复装证书', async t => {
  const f = setup(t); f.config.apply()
  await f.protection.initialize()
  assert.equal(f.protection.snapshot().state, 'configured')
  assert.deepEqual(f.events, ['start', 'trust'])
})

test('仅当前接入后完成且正文校验通过的真实请求才能显示已验证', async t => {
  const f = setup(t); await f.protection.enable()
  const record: RecordSummary = { id: 'synthetic', time: new Date(Date.now() + 1).toISOString(), endpoint: '/test', model: 'synthetic',
    provider: 'client', action: 'MASK', categories: ['EMAIL'], findings: 1, status: 'completed', durationMs: 10, source: 'api', stream: false,
    transport: 'https-proxy', outbound: { sha256: 'a'.repeat(64), bytes: 12, authenticationUnchanged: true, originalsAbsent: true } }
  for (const modified of [{ status: 'blocked' as const }, { transport: undefined }, { time: new Date(0).toISOString() }, { outbound: undefined }]) {
    f.protection.observe([{ ...record, ...modified }]); assert.equal(f.protection.snapshot().state, 'configured')
  }
  f.protection.observe([record]); assert.equal(f.protection.snapshot().state, 'verified')
  f.proxy.running = false; f.protection.runtimeChanged()
  assert.equal(f.protection.snapshot().state, 'error')
  assert.equal(f.protection.snapshot().lastVerifiedAt, undefined)
})

test('损坏的配置或恢复资料不会被空配置覆盖', t => {
  const f = setup(t); writeFileSync(f.path, '{broken')
  assert.throws(() => f.config.apply(), /无法读取/)
  assert.equal(readFileSync(f.path, 'utf8'), '{broken')
  writeFileSync(f.path, '{}'); writeFileSync(f.config.backupPath, '{"schema":999}')
  assert.throws(() => f.config.apply(), /恢复资料损坏/)
  assert.deepEqual(f.read(), {})
})

test('连接配置损坏时应用仍能显示错误，操作不会永久停在加载状态', async t => {
  const initial = setup(t)
  initial.config.apply(); writeFileSync(initial.path, '{broken')
  await initial.protection.initialize()
  assert.equal(initial.protection.snapshot().state, 'error')
  const active = setup(t); await active.protection.enable()
  writeFileSync(active.config.backupPath, '{broken')
  await assert.rejects(active.protection.disable())
  assert.equal(active.protection.snapshot().state, 'error')
  assert.equal(active.protection.snapshot().managed, true)
  const fresh = setup(t); writeFileSync(fresh.path, '{broken')
  await assert.rejects(fresh.protection.enable())
  assert.equal(fresh.protection.snapshot().state, 'error')
})

test('不支持的构建不能启动接入，并发点击不会重复修改或启动', async t => {
  const f = setup(t)
  const unavailable = new WorkBuddyProtection(f.config, f.services, false)
  await unavailable.initialize(); await assert.rejects(unavailable.enable())
  let proceed!: () => void
  f.services.checkCertificate = async () => { await new Promise<void>(resolve => { proceed = resolve }); return true }
  const start = f.protection.enable()
  await assert.rejects(f.protection.enable(), /正在进行/)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.protection.enable(), /正在进行/)
  await assert.rejects(f.protection.disable(), /正在进行/)
  proceed(); await start
  assert.equal(f.events.filter(e => e === 'close').length, 1)
})

test('运行时选择明确区分 macOS 架构与 Windows，未知平台无入口', () => {
  assert.match(nativeExecutable('/resources', 'darwin', 'arm64'), /mac-arm64.*mitmdump$/)
  assert.match(nativeExecutable('/resources', 'darwin', 'x64'), /mac-x64.*mitmdump$/)
  assert.match(nativeExecutable('/resources', 'win32', 'x64'), /win-x64.*mitmdump.exe$/)
  assert.equal(nativeExecutable('/resources', 'linux', 'x64'), '')
})

test('macOS 按实际 WorkBuddy 包路径识别 Electron 进程，排除其他 Electron 应用', () => {
  assert.equal(macWorkBuddyPath('/Applications/WorkBuddy AI.app/Contents/MacOS/Electron'), '/Applications/WorkBuddy AI.app')
  assert.equal(macWorkBuddyPath('/Users/example/Applications/WorkBuddy AI.app/Contents/MacOS/Electron'), '/Users/example/Applications/WorkBuddy AI.app')
  assert.equal(macWorkBuddyPath('/Applications/Other.app/Contents/MacOS/Electron'), undefined)
  assert.equal(macWorkBuddyPath('/Applications/WorkBuddy AI.app/Contents/Frameworks/WorkBuddy AI Helper'), undefined)
})
