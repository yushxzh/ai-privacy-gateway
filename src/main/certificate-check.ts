import { connect as tcpConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powershell } from './workbuddy-process'
const exec = promisify(execFile)

/** 仅建立 TLS 握手：验证代理与证书，不发送 Prompt、登录数据或模型请求。 */
async function proxyCertificate(ca: Buffer, port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port })
    let secure: ReturnType<typeof tlsConnect> | undefined
    const timer = setTimeout(() => done(new Error('无法连接 WorkBuddy 官方服务，请检查网络。')), 12000)
    let finished = false
    function done(error?: Error, certificate?: Buffer) {
      if (finished) return
      finished = true; clearTimeout(timer); secure?.destroy(); socket.destroy()
      if (error) reject(error); else resolve(certificate!)
    }
    socket.once('error', () => done(new Error('本地代理尚未就绪。')))
    socket.once('connect', () => socket.write('CONNECT www.workbuddy.ai:443 HTTP/1.1\r\nHost: www.workbuddy.ai:443\r\n\r\n'))
    let head = Buffer.alloc(0)
    function receive(chunk: Buffer) {
      head = Buffer.concat([head, chunk])
      if (head.length > 8192) return done(new Error('代理握手响应异常。'))
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', receive)
      if (!/^HTTP\/1\.[01] 200\b/.test(head.toString())) return done(new Error('代理无法连接官方服务。'))
      const remainder = head.subarray(end + 4)
      if (remainder.length) socket.unshift(remainder)
      secure = tlsConnect({ socket, servername: 'www.workbuddy.ai', ca, rejectUnauthorized: true })
      secure.once('error', () => done(new Error('本地代理证书校验失败。')))
      secure.once('secureConnect', () => {
        const raw = secure!.getPeerCertificate().raw
        if (!raw) done(new Error('未取得 WorkBuddy 连接证书。')); else done(undefined, raw)
      })
    }
    socket.on('data', receive)
  })
}

export async function checkUserCertificate(caDirectory: string, port = 18788, platform = process.platform): Promise<boolean> {
  const ca = await readFile(join(caDirectory, 'mitmproxy-ca-cert.pem'))
  const leaf = await proxyCertificate(ca, port)
  const path = join(caDirectory, 'connection-check.cer')
  await writeFile(path, leaf, { mode: 0o600 })
  try {
    if (platform === 'darwin') { await exec('security', ['verify-cert', '-c', path, '-p', 'ssl', '-s', 'www.workbuddy.ai'], { timeout: 15000 }); return true }
    if (platform === 'win32') {
      const expected = new X509Certificate(ca).fingerprint256.replaceAll(':', '')
      const script = `$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${path.replaceAll("'", "''")}'); $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain; $chain.ChainPolicy.RevocationMode = 'NoCheck'; $ok = $chain.Build($cert); if (-not $ok) { exit 2 }; $root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate; $sha = [System.Security.Cryptography.SHA256]::Create(); $hash = [BitConverter]::ToString($sha.ComputeHash($root.RawData)).Replace('-',''); if ($hash -ne '${expected}') { exit 3 }`
      await powershell(script); return true
    }
    return false
  } catch { return false }
  finally { await rm(path, { force: true }) }
}
