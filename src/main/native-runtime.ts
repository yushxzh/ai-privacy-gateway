import { access, chmod, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from 'node:net'

/** 异常退出后的旧 TLS 进程会自行结束；重开和撤销证书都先等待端口释放。 */
export async function waitForNativeProxyExit(port = 18788): Promise<void> {
  const deadline = Date.now() + 12000
  while (true) {
    const occupied = await new Promise<boolean>(resolve => {
      const socket = connect({ host: '127.0.0.1', port })
      const done = (value: boolean) => { socket.destroy(); resolve(value) }
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.setTimeout(250, () => done(true))
    })
    if (!occupied) return
    if (Date.now() >= deadline) throw new Error('本地代理端口尚未释放，请稍后重试或处理端口占用。')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

export function nativeExecutable(resources: string, platform = process.platform, arch = process.arch): string {
  if (platform === 'darwin') return join(resources, `native/mac-${arch === 'arm64' ? 'arm64' : 'x64'}/mitmproxy.app/Contents/MacOS/mitmdump`)
  if (platform === 'win32' && arch === 'x64') return join(resources, 'native/win-x64/mitmdump.exe')
  return ''
}
export async function prepareCertificateDirectory(directory: string, previous?: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (previous && previous !== directory) {
    try { await access(join(directory, 'mitmproxy-ca.pem')) }
    catch {
      // 迁移显式配置的旧证书，保持已授权的信任指纹；不读取登录资料。
      await cp(join(previous, 'mitmproxy-ca.pem'), join(directory, 'mitmproxy-ca.pem'), { errorOnExist: true, force: false })
      await cp(join(previous, 'mitmproxy-ca-cert.pem'), join(directory, 'mitmproxy-ca-cert.pem'), { errorOnExist: true, force: false })
    }
  }
  for (const name of ['mitmproxy-ca.pem', 'mitmproxy-ca-cert.pem']) await chmod(join(directory, name), 0o600).catch(() => {})
}
