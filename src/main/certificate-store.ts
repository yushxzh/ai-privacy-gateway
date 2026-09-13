import { X509Certificate } from 'node:crypto'
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writePrivateJson } from './workbuddy-proxy-settings'

const exec = promisify(execFile)
type Run = (file: string, args: string[]) => Promise<{ stdout: string }>
const runCommand: Run = (file, args) => exec(file, args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
interface CertificateIdentity { schema: 1; pem: string; sha256: string }

function identity(pem: string): CertificateIdentity {
  if (pem.length > 32 * 1024 || !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(pem))
    throw new Error('本机证书资料无效，请先修复后重试。')
  const cert = new X509Certificate(pem)
  if (!cert.ca) throw new Error('本机证书不是 CA，已停止操作。')
  return { schema: 1, pem: cert.toString(), sha256: cert.fingerprint256.replaceAll(':', '') }
}

/** 以本产品保存的公钥证书和指纹定位信任，绝不按共用证书名称批量删除。 */
export class CertificateStore {
  readonly statePath: string
  constructor(readonly directory: string, private platform = process.platform, private run: Run = runCommand,
    private keychain = join(homedir(), 'Library/Keychains/login.keychain-db')) {
    this.statePath = join(dirname(directory), 'certificate.json')
  }

  async present(): Promise<boolean> {
    for (const path of [this.statePath, join(this.directory, 'mitmproxy-ca.pem'), join(this.directory, 'mitmproxy-ca-cert.pem'), join(this.directory, 'mitmproxy-ca.p12')]) {
      try { await access(path); return true } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取本机证书资料。')
      }
    }
    return false
  }

  private async current(): Promise<CertificateIdentity | undefined> {
    try { return identity(await readFile(join(this.directory, 'mitmproxy-ca-cert.pem'), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('本机公开证书无法读取，已保留证书资料。')
      try {
        const source = await readFile(join(this.directory, 'mitmproxy-ca.pem'), 'utf8')
        const pem = source.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)
        if (!pem) throw new Error('missing certificate')
        return identity(pem[0])
      } catch (fallback) {
        if ((fallback as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw new Error('无法确认本机 CA 身份，已保留私钥与恢复资料。')
      }
    }
  }

  private async saved(): Promise<CertificateIdentity | undefined> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8'))
      if (value?.schema !== 1 || typeof value.pem !== 'string') throw new Error('invalid identity')
      const result = identity(value.pem)
      if (result.sha256 !== value.sha256) throw new Error('fingerprint mismatch')
      return result
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('证书撤销资料损坏，已保留现有信任和私钥，请先修复。')
    }
  }

  async remember(): Promise<void> {
    const current = await this.current()
    if (!current) throw new Error('尚未生成本机 CA。')
    const saved = await this.saved()
    if (saved && saved.sha256 !== current.sha256) throw new Error('CA 与接入记录不一致，请先移除旧接入。')
    if (!saved) writePrivateJson(this.statePath, current)
  }

  async remove(): Promise<void> {
    const [current, saved] = await Promise.all([this.current(), this.saved()])
    if (current && saved && current.sha256 !== saved.sha256)
      throw new Error('CA 与撤销资料不一致，已停止删除，请先修复。')
    const certificate = saved ?? current
    if (!certificate) {
      const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      if (files.length) throw new Error('证书身份资料缺失，无法确认系统信任已撤销，已保留本机文件。')
    }
    if (certificate) {
      // 在系统授权前保存公钥资料；撤销取消或文件清理失败后仍能重试。
      if (!saved) writePrivateJson(this.statePath, certificate)
      if (this.platform === 'darwin') {
        const exported = join(dirname(this.directory), 'revoke-certificate.pem')
        await writeFile(exported, certificate.pem, { mode: 0o600 })
        try {
          try { await this.run('security', ['remove-trusted-cert', exported]) }
          catch (error) {
            // 用户从钥匙串手工删掉证书后，撤销操作仍应可重复。
            if (!/(-25300|item could not be found|no trust settings)/i.test(String((error as { stderr?: string }).stderr ?? '')))
              throw new Error('证书信任未能撤销，请完成系统授权后重试。')
          }
          const contains = async () => {
            try {
              const { stdout } = await this.run('security', ['find-certificate', '-a', '-Z', this.keychain])
              return stdout.split('\n').some(line => line.trim() === 'SHA-256 hash: ' + certificate.sha256)
            } catch (error) {
              if (/(-25300|item could not be found)/i.test(String((error as { stderr?: string }).stderr ?? ''))) return false
              throw new Error('无法核对钥匙串中的证书，已保留撤销资料，请重试。')
            }
          }
          if (await contains()) await this.run('security', ['delete-certificate', '-Z', certificate.sha256, '-t', this.keychain])
          if (await contains()) throw new Error('钥匙串中仍有本产品证书，请重试移除。')
        } finally { await rm(exported, { force: true }) }
      } else if (this.platform === 'win32') {
        const script = `$ErrorActionPreference = 'Stop'; $sha = [System.Security.Cryptography.SHA256]::Create(); try { ` +
          `$matches = @(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { [BitConverter]::ToString($sha.ComputeHash($_.RawData)).Replace('-','') -eq '${certificate.sha256}' }); ` +
          `$matches | ForEach-Object { Remove-Item -LiteralPath $_.PSPath -ErrorAction Stop }; ` +
          `if (@(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { [BitConverter]::ToString($sha.ComputeHash($_.RawData)).Replace('-','') -eq '${certificate.sha256}' }).Count -ne 0) { exit 2 } ` +
          `} finally { $sha.Dispose() }`
        try { await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]) }
        catch { throw new Error('当前用户的证书信任未能撤销，已保留私钥和撤销资料，请重试。') }
      } else throw new Error('当前系统不支持证书撤销。')
    }
    await rm(this.directory, { recursive: true, force: true })
    await rm(this.statePath, { force: true })
  }
}
