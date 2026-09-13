import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { watchFile, unwatchFile, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PrivacyGateway } from '../gateway/server'
import { DEFAULT_SETTINGS } from '../gateway/providers'
import { GatewayError } from '../gateway/errors'
import { generateGuide, SOURCE_URLS } from '../shared/integrations'
import type { ClientKind, Settings, ShellKind } from '../shared/types'
import { WorkBuddyConnections } from './workbuddy-config'
import { NativeProxy } from './native-proxy'
import { RuleSettings } from '../privacy/rule-settings'
import { previewCustomRule } from '../privacy/rule-preview'
import type { CustomRuleInput, RulePolicy } from '../shared/rule-settings'
import { WorkBuddyProtection } from './protection'
import { WorkBuddyProxySettings } from './workbuddy-proxy-settings'
import { WorkBuddyProcess, installUserCertificate } from './workbuddy-process'
import { nativeExecutable, prepareCertificateDirectory, waitForNativeProxyExit } from './native-runtime'
import { checkUserCertificate } from './certificate-check'
import { CertificateStore } from './certificate-store'
import { prepareUninstall } from './uninstall'

if (!app.isPackaged && process.env.APG_TEST_USER_DATA) app.setPath('userData', process.env.APG_TEST_USER_DATA)
app.setName('AI Privacy Gateway')
const requestedPort = Number(process.env.PRIVACY_GATEWAY_PORT || 8787)
const port =
  Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535 ? requestedPort : 8787
const rules = new RuleSettings(join(app.getPath('userData'), 'rule-settings.json'))
const gateway = new PrivacyGateway({ ...DEFAULT_SETTINGS, port }, undefined, rules)
rules.on('change', () => gateway.emit('change'))
const workbuddyConfigPath = join(
  !app.isPackaged && process.env.APG_TEST_USER_DATA ? process.env.APG_TEST_USER_DATA : homedir(),
  '.workbuddy-ai', 'models.json'
)

const workbuddy = new WorkBuddyConnections(workbuddyConfigPath, join(app.getPath('userData'), 'workbuddy-connections.json'), gateway)
let window: BrowserWindow | null = null
let quitting = false
let closing = false
let nativeProxy: NativeProxy | undefined
let protection: WorkBuddyProtection | undefined
let shutdownError: string | undefined
let workbuddySettingsPath: string | undefined
const snapshot = () => ({ ...gateway.snapshot(), error: shutdownError ?? rules.snapshot().error ?? gateway.snapshot().error,
  nativeHttps: nativeProxy?.running ?? false, protection: protection?.snapshot() })

function verifySender(event: IpcMainInvokeEvent): void {
  const expected =
    process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const actual = event.senderFrame?.url
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !actual ||
    new URL(actual).href !== new URL(expected).href
  ) {
    throw new Error('拒绝未知界面的请求。')
  }
}

function handle<Args extends unknown[]>(channel: string, handler: (...args: Args) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    verifySender(event)
    try {
      return await handler(...(args as Args))
    } catch (error) {
      throw new Error(error instanceof GatewayError ? error.message : '操作未完成，请重试。')
    }
  })
}

const uninstalling = process.argv.includes('--prepare-uninstall')
if (!app.requestSingleInstanceLock()) {
  if (uninstalling) app.exit(20)
  else app.quit()
}
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app
    .whenReady()
    .then(async () => {
      if (uninstalling) {
        try {
          await waitForNativeProxyExit()
          await prepareUninstall(new WorkBuddyProxySettings(
            join(homedir(), '.workbuddy-ai/settings.json'), join(app.getPath('userData'), 'native-https/connection.json')),
          workbuddy, new CertificateStore(join(app.getPath('userData'), 'native-https/ca')))
          app.exit(0)
        } catch {
          console.error('接入或证书尚未完全恢复。请打开应用完成「移除接入和证书」，检查自定义模型原地址，再重新卸载。')
          app.exit(21)
        }
        return
      }
      const icon = nativeImage.createFromPath(
        app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
      )
      app.dock?.setIcon(icon)
      const uiSession = session.fromPartition('privacy-ui')
      uiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      uiSession.setPermissionCheckHandler(() => false)
      const dev = !!process.env.ELECTRON_RENDERER_URL && !app.isPackaged
      uiSession.webRequest.onHeadersReceived((details, callback) => {
        const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${dev ? ' ws://127.0.0.1:*' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
      })
      window = new BrowserWindow({
        width: 1360,
        height: 920,
        minWidth: 1040,
        minHeight: 720,
        show: false,
        title: 'AI Privacy Gateway',
        backgroundColor: '#f6f8f6',
        autoHideMenuBar: true,
        icon,
        titleBarStyle: 'hidden',
        ...(process.platform === 'darwin'
          ? { trafficLightPosition: { x: 18, y: 20 } }
          : { titleBarOverlay: { color: '#ffffff', symbolColor: '#25372e', height: 56 } }),
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          session: uiSession
        }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit() } })
      window.on('closed', () => {
        window = null
      })
      handle('privacy:snapshot', snapshot)
      handle('privacy:protection', async (enabled: boolean) => {
        if (typeof enabled !== 'boolean' || !protection) throw new Error('参数有误。')
        try { const result = enabled ? await protection.enable() : await protection.disable(); shutdownError = undefined; return result }
        catch (error) { throw new GatewayError(503, 'protection_failed', error instanceof Error ? error.message : '接入未完成。') }
      })
      handle('privacy:protection-remove', async () => {
        if (!protection) throw new GatewayError(503, 'protection_unavailable', '接入服务尚未就绪。')
        try { const result = await protection.remove(); shutdownError = undefined; return result }
        catch (error) { throw new GatewayError(503, 'removal_failed', error instanceof Error ? error.message : '移除尚未完成。') }
      })
      handle('privacy:record', (id: string, reveal: boolean) => {
        if (typeof id !== 'string' || typeof reveal !== 'boolean') throw new Error('参数有误。')
        return gateway.records.detail(id, reveal)
      })
      handle('privacy:clear', () => gateway.records.clear())
      handle('privacy:running', async (running: boolean) => {
        if (typeof running !== 'boolean') throw new Error('参数有误。')
        if (running) await gateway.start()
        else {
          try { await protection?.disable() }
          catch { throw new GatewayError(503, 'restore_failed', '请先在「保护」页恢复 WorkBuddy 原连接，再停止网关。') }
          await gateway.stop()
        }
        return snapshot()
      })
      handle('privacy:settings', async (settings: Settings & { apiKey: string }) => {
        await gateway.saveSettings(settings, settings.apiKey)
        return snapshot()
      })
      handle('privacy:demo', (text: string) => gateway.demo(text))
      handle('privacy:rules-inspect', (text: string) => gateway.inspectRules(text))
      handle('privacy:rules-settings', () => rules.snapshot())
      handle('privacy:rules-policy', (id: string, policy: RulePolicy, revision: number) => rules.setPolicy(id, policy, revision))
      handle('privacy:rules-save', (id: string | null, input: CustomRuleInput, revision: number) => rules.saveCustom(id, input, revision))
      handle('privacy:rules-delete', (id: string, revision: number) => rules.deleteCustom(id, revision))
      handle('privacy:rules-preview', (input: CustomRuleInput, text: string) => previewCustomRule(input, text))
      handle('privacy:rules-samples', () => gateway.verifyRuleSamples())
      handle('privacy:guide', (client: ClientKind, shellKind: ShellKind) => {
        if (!Object.hasOwn(SOURCE_URLS, client) || !['bash', 'powershell'].includes(shellKind))
          throw new Error('参数有误。')
        return generateGuide(client, shellKind, gateway.snapshot().settings, gateway.token)
      })
      handle('privacy:workbuddy', () => workbuddy.configuration())
      handle('privacy:workbuddy-model', (id: string, enabled: boolean) => workbuddy.setModel(id, enabled))
      handle('privacy:copy', (text: string) => {
        if (typeof text !== 'string' || text.length > 100000) throw new Error('参数有误。')
        clipboard.writeText(text)
      })
      handle('privacy:docs', (topic: ClientKind) => {
        if (!Object.hasOwn(SOURCE_URLS, topic)) throw new Error('参数有误。')
        return shell.openExternal(SOURCE_URLS[topic])
      })
      handle('privacy:help', () => shell.openExternal('https://github.com/yushxzh/ai-privacy-gateway/blob/main/docs/USAGE.md'))
      gateway.on('change', () => {
        protection?.observe(gateway.snapshot().records)
        if (window && !window.webContents.isDestroyed()) window.webContents.send('privacy:changed')
      })
      await gateway.start().catch(() => {})
      const isolated = !app.isPackaged && !!process.env.APG_TEST_USER_DATA
      const executable = process.env.APG_HTTPS_RUNTIME || nativeExecutable(app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources'))
      const available = !isolated && !!executable && existsSync(executable)
      const caDirectory = join(app.getPath('userData'), 'native-https/ca')
      const certificate = new CertificateStore(caDirectory)
      const proxySettings = new WorkBuddyProxySettings(
        join(isolated ? process.env.APG_TEST_USER_DATA! : homedir(), '.workbuddy-ai/settings.json'),
        join(app.getPath('userData'), 'native-https/connection.json'))
      workbuddySettingsPath = proxySettings.settingsPath
      if (available) {
        await prepareCertificateDirectory(caDirectory, process.env.APG_HTTPS_CA_DIR)
        nativeProxy = new NativeProxy(gateway.records, executable,
          app.isPackaged ? join(process.resourcesPath, 'https/workbuddy.py') : join(__dirname, '../../src/https/workbuddy.py'),
          caDirectory, 18788, rules)
        nativeProxy.on('change', () => { protection?.runtimeChanged(); gateway.emit('change') })
        if (process.env.APG_HTTPS_CA_DIR && proxySettings.isConnected() && !proxySettings.backup()) proxySettings.apply()
      }
      protection = new WorkBuddyProtection(proxySettings, {
        client: new WorkBuddyProcess(isolated ? 'linux' : process.platform),
        proxy: nativeProxy ?? { running: false, async start() { throw new Error('运行时未安装。') }, async stop() {} },
        checkCertificate: async () => { await certificate.remember(); return checkUserCertificate(caDirectory) },
        installCertificate: () => installUserCertificate(join(caDirectory, 'mitmproxy-ca-cert.pem')),
        certificatePresent: () => certificate.present(),
        removeCertificate: async () => { if (!isolated) await waitForNativeProxyExit(); await certificate.remove() }
      }, available)
      protection.on('change', () => { if (window && !window.webContents.isDestroyed()) window.webContents.send('privacy:changed') })
      await protection.initialize()
      watchFile(workbuddySettingsPath, { interval: 1000, persistent: false }, () => protection?.configurationChanged())
      await workbuddy.configuration()
      // 同时兼容文件替换与删除；配置不再指向本网关时撤销对应入口。
      watchFile(workbuddyConfigPath, { interval: 1000, persistent: false }, () => {
        void workbuddy.configuration().then(() => {
          if (window && !window.webContents.isDestroyed()) window.webContents.send('privacy:changed')
        })
      })
      if (dev) await window.loadURL(process.env.ELECTRON_RENDERER_URL!)
      else await window.loadFile(join(__dirname, '../renderer/index.html'))
      window.show()
    })
    .catch(() => {
      console.error('桌面应用启动失败。')
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    if (closing) return
    closing = true
    void (async () => {
      try {
        await protection?.disable()
        await nativeProxy?.stop()
        await gateway.stop()
        unwatchFile(workbuddyConfigPath)
        if (workbuddySettingsPath) unwatchFile(workbuddySettingsPath)
        gateway.records.clear()
        quitting = true
        app.quit()
      } catch {
        closing = false
        shutdownError = 'WorkBuddy 原连接尚未恢复，应用暂未退出。请关闭 WorkBuddy 后点击「停止并恢复」，再退出网关。'
        window?.show(); gateway.emit('change')
      }
    })()
  })
}
