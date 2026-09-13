import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { CertificateStore } from '../src/main/certificate-store'

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-certificate-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ca = join(dir, 'ca')
  mkdirSync(ca)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=APG synthetic test CA', '-keyout', join(ca, 'mitmproxy-ca.pem'), '-out', join(ca, 'mitmproxy-ca-cert.pem')], { stdio: 'ignore' })
  const pem = readFileSync(join(ca, 'mitmproxy-ca-cert.pem'), 'utf8')
  const sha256 = new X509Certificate(pem).fingerprint256.replaceAll(':', '')
  return { dir, ca, pem, sha256 }
}

test('按 SHA-256 精确移除本产品证书，保留同名的其他证书；重复移除可用', async t => {
  const f = fixture(t)
  const other = 'B'.repeat(64)
  const certificates = new Set([f.sha256, other])
  const commands: string[][] = []
  const store = new CertificateStore(f.ca, 'darwin', async (file, args) => {
    assert.equal(file, 'security'); commands.push(args)
    if (args[0] === 'find-certificate') return { stdout: [...certificates].map(hash => 'SHA-256 hash: ' + hash).join('\n') }
    if (args[0] === 'delete-certificate') certificates.delete(args[args.indexOf('-Z') + 1])
    return { stdout: '' }
  }, '/synthetic/login.keychain-db')
  await store.remember()
  assert.equal(readFileSync(store.statePath, 'utf8').includes('PRIVATE KEY'), false)
  await store.remove()
  assert.deepEqual([...certificates], [other])
  assert.ok(commands.find(args => args[0] === 'delete-certificate' && args.includes(f.sha256)))
  assert.equal(await store.present(), false)
  const count = commands.length
  await store.remove()
  assert.equal(commands.length, count)
})

test('系统授权取消保留 CA 私钥和撤销身份，再次授权后可完成', async t => {
  const f = fixture(t)
  let cancel = true
  const store = new CertificateStore(f.ca, 'darwin', async () => {
    if (cancel) throw new Error('synthetic cancellation')
    return { stdout: '' }
  })
  await assert.rejects(store.remove(), /系统授权/)
  assert.equal(existsSync(join(f.ca, 'mitmproxy-ca.pem')), true)
  assert.equal(existsSync(store.statePath), true)
  cancel = false
  await store.remove()
  assert.equal(await store.present(), false)
})

test('公开证书被手工删除后仍以保存的公钥身份撤销；损坏身份不会执行删除', async t => {
  const f = fixture(t)
  const commands: string[][] = []
  const store = new CertificateStore(f.ca, 'darwin', async (_file, args) => { commands.push(args); return { stdout: '' } })
  await store.remember()
  rmSync(f.ca, { recursive: true })
  await store.remove()
  assert.ok(commands.find(args => args[0] === 'remove-trusted-cert'))
  const broken = fixture(t)
  const brokenStore = new CertificateStore(broken.ca, 'darwin', async () => { throw new Error('must not execute') })
  writeFileSync(brokenStore.statePath, '{broken')
  await assert.rejects(brokenStore.remove(), /撤销资料损坏/)
  assert.equal(existsSync(join(broken.ca, 'mitmproxy-ca.pem')), true)
})

test('CA 被替换时不能覆盖原撤销身份或误删新的证书', async t => {
  const first = fixture(t), second = fixture(t)
  let executed = false
  const store = new CertificateStore(first.ca, 'darwin', async () => { executed = true; return { stdout: '' } })
  await store.remember()
  writeFileSync(join(first.ca, 'mitmproxy-ca-cert.pem'), second.pem)
  await assert.rejects(store.remember(), /不一致/)
  await assert.rejects(store.remove(), /不一致/)
  assert.equal(executed, false)
  assert.equal(existsSync(join(first.ca, 'mitmproxy-ca.pem')), true)
})

test('Windows 撤销命令限定当前用户并校对 SHA-256，失败不会删除私钥', async t => {
  const f = fixture(t)
  const store = new CertificateStore(f.ca, 'win32', async (file, args) => {
    assert.equal(file, 'powershell.exe')
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    assert.match(script, /Cert:\\CurrentUser\\Root/)
    assert.ok(script.includes(f.sha256))
    assert.ok(!script.includes('LocalMachine'))
    assert.ok(!script.includes('PRIVATE KEY'))
    throw new Error('synthetic denied')
  })
  await assert.rejects(store.remove(), /证书信任未能撤销/)
  assert.equal(existsSync(join(f.ca, 'mitmproxy-ca.pem')), true)
})
