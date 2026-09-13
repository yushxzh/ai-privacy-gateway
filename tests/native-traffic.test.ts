import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer as createHttpsServer } from 'node:https'
import { createServer, connect } from 'node:net'
import { connect as secureConnect } from 'node:tls'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeBridge } from '../src/gateway/native-bridge'
import { RecordStore } from '../src/gateway/records'
import { RuleSettings } from '../src/privacy/rule-settings'

test('真实 TLS 上游只收到已检查正文：异常格式、未知字段、阻断及检查失联均无请求到达上游', { timeout: 40000 }, async t => {
  assert.ok(process.env.APG_TEST_PYTHON)
  const dir = await mkdtemp(join(tmpdir(), 'apg-real-traffic-'))
  const ca = join(dir, 'proxy-ca')
  await mkdir(ca)
  const certificate = join(dir, 'upstream.pem'), key = join(dir, 'upstream.key')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=www.workbuddy.ai', '-addext', 'subjectAltName=DNS:www.workbuddy.ai', '-keyout', key, '-out', certificate], { stdio: 'ignore' })
  const received: { body: string; auth?: string }[] = []
  const upstream = createHttpsServer({ key: await readFile(key), cert: await readFile(certificate) }, async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    received.push({ body, auth: request.headers.authorization })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ result: 'synthetic success' }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const proxyPort = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const records = new RecordStore(), rules = new RuleSettings()
  rules.setPolicy('password', { enabled: true, action: 'BLOCK' }, 0)
  const bridge = new NativeBridge(records, rules)
  await bridge.start()
  const runtime = process.env.APG_TEST_MITMDUMP || join(dirname(process.env.APG_TEST_PYTHON), 'mitmdump')
  const child = spawn(runtime, ['--listen-host', '127.0.0.1', '--listen-port', String(proxyPort),
    '--set', `confdir=${ca}`, '--set', `ssl_verify_upstream_trusted_ca=${certificate}`,
    '--set', 'connection_strategy=lazy', '--set', 'upstream_cert=false', '--set', 'body_size_limit=4m',
    '--set', 'flow_detail=0', '-s', resolve('tests/native-upstream.py')],
  { stdio: 'ignore', env: { ...process.env, APG_NATIVE_BRIDGE_URL: bridge.url, APG_NATIVE_BRIDGE_TOKEN: bridge.token, APG_TEST_UPSTREAM_PORT: String(upstreamPort) } })
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()) })
  t.after(async () => {
    await bridge.stop()
    if (child.exitCode === null) child.kill('SIGTERM')
    await exited
    await new Promise<void>(resolve => { upstream.close(() => resolve()); upstream.closeAllConnections() })
    await rm(dir, { recursive: true, force: true })
  })
  await bridge.waitUntilReady()
  const proxyCa = await readFile(join(ca, 'mitmproxy-ca-cert.pem'))

  async function send(body: string, contentType = 'application/json', path = '/v2/chat/completions'): Promise<number> {
    const socket = connect({ host: '127.0.0.1', port: proxyPort })
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    socket.write('CONNECT www.workbuddy.ai:443 HTTP/1.1\r\nHost: www.workbuddy.ai:443\r\n\r\n')
    await new Promise<void>((resolve, reject) => {
      let head = Buffer.alloc(0)
      const read = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk])
        const end = head.indexOf('\r\n\r\n')
        if (end < 0) return
        socket.off('data', read)
        if (!head.toString().startsWith('HTTP/1.1 200')) { socket.destroy(); reject(new Error('CONNECT failed')); return }
        if (end + 4 < head.length) socket.unshift(head.subarray(end + 4))
        resolve()
      }
      socket.on('data', read); socket.once('error', reject)
    })
    const secure = secureConnect({ socket, servername: 'www.workbuddy.ai', ca: proxyCa, rejectUnauthorized: true })
    return new Promise<number>((resolve, reject) => {
      let response = ''
      secure.setTimeout(8000, () => secure.destroy(new Error('synthetic request timed out')))
      secure.once('secureConnect', () => secure.write(`POST ${path} HTTP/1.1\r\nHost: www.workbuddy.ai\r\nAuthorization: Bearer synthetic-original-login\r\nContent-Type: ${contentType}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`))
      secure.on('data', chunk => { response += chunk.toString() })
      secure.once('error', reject)
      secure.once('end', () => { secure.destroy(); resolve(Number(response.match(/^HTTP\/1\.[01] (\d{3})/)?.[1])) })
    })
  }
  const modelRequest = (content: string) => JSON.stringify({ model: 'synthetic-model', messages: [{ role: 'user', content }] })
  assert.equal(await send(modelRequest('native.traffic@example.com')), 200)
  assert.equal(received.length, 1)
  assert.equal(received[0].auth, 'Bearer synthetic-original-login')
  assert.equal(received[0].body.includes('native.traffic@example.com'), false)
  assert.ok(received[0].body.includes('⟦EMAIL_'))
  const invalid = [
    ['{invalid synthetic-secret', 'application/json'],
    [modelRequest('synthetic-secret'), 'text/plain'],
    [JSON.stringify({ model: 'synthetic-model', input: 'synthetic-secret' }), 'application/json'],
    [JSON.stringify({ model: 'synthetic-model', messages: [{ role: 'user', content: 'hello', unknown: 'synthetic-secret' }] }), 'application/json'],
    [modelRequest('password=synthetic-private'), 'application/json']
  ]
  for (const [body, type] of invalid) {
    assert.equal(await send(body, type), 422)
    assert.equal(received.length, 1)
  }
  assert.equal(await send('outside-scope-synthetic-secret', 'text/plain', '/telemetry'), 200)
  assert.equal(received.length, 2)
  assert.equal(records.summaries().filter(record => record.inspectionIssue === 'outside-scope').length, 1)
  assert.equal(records.counts().allowed, 0)
  assert.equal(JSON.stringify(records.summaries()).includes('synthetic-secret'), false)
  await bridge.stop()
  assert.equal(await send(modelRequest('native.offline@example.com')), 502)
  assert.equal(received.length, 2)
})
