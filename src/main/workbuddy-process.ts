import { execFile, spawn } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const psQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export function macWorkBuddyPath(command: string): string | undefined {
  // WorkBuddy 5.5.2 的 CFBundleExecutable 为 Electron，不能用展示名称判断进程。
  return command.trim().match(/^(.*\/WorkBuddy AI\.app)\/Contents\/MacOS\/(?:Electron|WorkBuddy AI)$/)?.[1]
}
export async function powershell(script: string): Promise<string> {
  return (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 })).stdout
}

export class WorkBuddyProcess {
  constructor(private platform = process.platform, private configDirectory = join(homedir(), '.workbuddy-ai')) {}
  async clearCertificateCache(): Promise<void> {
    // WorkBuddy 会跨重启复用此派生文件；证书变更后必须让客户端从系统重新生成。
    try { await rm(join(this.configDirectory, 'system-ca-bundle.pem'), { force: true }) }
    catch { throw new Error('无法刷新 WorkBuddy 的证书缓存，请检查文件权限后重试。') }
  }
  async executable(): Promise<string | undefined> {
    const candidates = this.platform === 'darwin'
      ? ['/Applications/WorkBuddy AI.app', join(homedir(), 'Applications/WorkBuddy AI.app')]
      : this.platform === 'win32'
        ? [join(process.env.LOCALAPPDATA || '', 'Programs/WorkBuddy AI/WorkBuddy AI.exe'),
          join(process.env.LOCALAPPDATA || '', 'Programs/workbuddy-ai/WorkBuddy AI.exe'),
          join(process.env.ProgramFiles || '', 'WorkBuddy AI/WorkBuddy AI.exe')]
        : []
    if (this.platform === 'win32') {
      const current = await this.runningPath().catch(() => undefined)
      if (current) candidates.unshift(current)
      const installed = await powershell("Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'WorkBuddy AI' -or $_.DisplayName -eq 'WorkBuddy' } | ForEach-Object { $_.DisplayIcon } | Select-Object -First 1").catch(() => '')
      if (installed.trim()) candidates.push(installed.trim().replace(/^"|"(?:,\d+)?$|,\d+$/g, ''))
    }
    for (const candidate of candidates) { try { await access(candidate); return candidate } catch {} }
    return undefined
  }
  private async runningPath(): Promise<string | undefined> {
    if (this.platform === 'darwin') {
      const { stdout } = await exec('ps', ['-axo', 'comm='], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
      return stdout.split('\n').map(macWorkBuddyPath).find(Boolean)
    }
    if (this.platform === 'win32') {
      return (await powershell("Get-Process -Name 'WorkBuddy AI','WorkBuddy' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path")).trim() || undefined
    }
    return undefined
  }
  async running(): Promise<boolean> { return !!await this.runningPath() }
  async close(): Promise<boolean> {
    if (!await this.running()) return false
    if (this.platform === 'darwin') await exec('osascript', ['-e', 'tell application id "com.workbuddy.workbuddy-ai" to quit'], { timeout: 15000 })
    else if (this.platform === 'win32') await powershell("Get-Process -Name 'WorkBuddy AI','WorkBuddy' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() }")
    for (let i = 0; i < 40; i++) { if (!await this.running()) return true; await wait(250) }
    throw new Error('WorkBuddy 尚未退出，请保存当前任务并关闭它，再点击重试。')
  }
  async open(): Promise<void> {
    const file = await this.executable()
    if (!file) throw new Error('未找到 WorkBuddy，请先安装并正常登录。')
    if (this.platform === 'darwin') await exec('open', ['-a', file], { timeout: 10000 })
    else if (this.platform === 'win32') {
      const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false })
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) }); child.unref()
    }
    for (let i = 0; i < 60; i++) { if (await this.running()) return; await wait(250) }
    throw new Error('WorkBuddy 未能启动，请手动打开后重新检查连接。')
  }
}

export async function installUserCertificate(certificate: string, platform = process.platform): Promise<void> {
  try {
    if (platform === 'darwin') await exec('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-s', 'www.workbuddy.ai',
      '-k', join(homedir(), 'Library/Keychains/login.keychain-db'), certificate], { timeout: 120000 })
    else if (platform === 'win32') await powershell(`Import-Certificate -FilePath ${psQuote(certificate)} -CertStoreLocation Cert:\\CurrentUser\\Root -ErrorAction Stop | Out-Null`)
    else throw new Error('platform')
  } catch { throw new Error('证书信任尚未完成，请完成系统授权后重试。') }
}
