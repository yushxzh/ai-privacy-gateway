import { EventEmitter } from 'node:events'
import type { ProtectionSnapshot } from '../shared/protection'
import type { RecordSummary } from '../shared/types'
import { WorkBuddyProxySettings } from './workbuddy-proxy-settings'

interface Services {
  client: { executable(): Promise<string | undefined>; close(): Promise<boolean>; open(): Promise<void> }
  proxy: { running: boolean; start(): Promise<void>; stop(): Promise<void> }
  checkCertificate(): Promise<boolean>
  installCertificate(): Promise<void>
}

/** 配置写入与客户端重启是一项操作；恢复失败时保留代理和恢复资料。 */
export class WorkBuddyProtection extends EventEmitter {
  private value: ProtectionSnapshot
  private busy = false
  private connectedAt = 0
  constructor(private config: WorkBuddyProxySettings, private services: Services, available: boolean) {
    super()
    this.value = { state: 'off', available, managed: false, clientInstalled: false,
      certificateTrusted: false, message: '尚未开启 WorkBuddy 保护。' }
  }
  snapshot(): ProtectionSnapshot { return { ...this.value } }
  runtimeChanged(): void {
    if (!this.busy && ['configured', 'verified'].includes(this.value.state) && !this.services.proxy.running)
      this.update({ state: 'error', lastVerifiedAt: undefined, message: '本地代理已停止，当前连接不可用。请重试开启，或停止并恢复原连接。' })
  }
  configurationChanged(): void {
    if (this.busy || !this.value.managed) return
    try {
      if (!this.config.isConnected()) this.update({ state: 'error', lastVerifiedAt: undefined,
        message: 'WorkBuddy 的代理设置已改变。点击「停止并恢复」保留新设置，或重新开启保护。' })
    } catch { this.update({ state: 'error', message: '无法读取 WorkBuddy 代理设置，请检查本地配置。' }) }
  }
  private update(value: Partial<ProtectionSnapshot>): void { Object.assign(this.value, value); this.emit('change') }
  async initialize(): Promise<void> {
    this.update({ clientInstalled: !!await this.services.client.executable().catch(() => undefined) })
    if (!this.value.available) { this.update({ message: '此构建未包含本地代理运行时，请使用完整安装包。' }); return }
    // 上次异常退出后优先恢复同一端口，避免把客户端留在无服务的代理上。
    let hasBackup = false
    try { hasBackup = !!this.config.backup() }
    catch { this.update({ state: 'error', managed: true, message: '接入恢复资料损坏，请按仓库使用文档恢复连接。' }); return }
    if (hasBackup) {
      this.update({ managed: true })
      let connected = false
      try { connected = this.config.isConnected() }
      catch { this.update({ state: 'error', message: 'WorkBuddy 配置无法读取，请按仓库使用文档恢复连接。' }); return }
      if (connected) {
        try {
          await this.services.proxy.start()
          const trusted = await this.services.checkCertificate()
          this.connectedAt = Date.now()
          this.update({ state: trusted ? 'configured' : 'error', certificateTrusted: trusted,
            message: trusted ? '已恢复 WorkBuddy 连接，等待新请求验证。' : '本地证书尚未受信任，请重新开启保护完成授权。' })
        } catch { this.update({ state: 'error', message: '上次连接未恢复，请重试开启，或停止并恢复原连接。' }) }
      } else this.update({ state: 'error', message: '检测到未完成的恢复，请点击「停止并恢复」完成处理。' })
    }
  }
  observe(records: RecordSummary[]): void {
    if (!['configured', 'verified'].includes(this.value.state)) return
    const verified = records.find(record => record.transport === 'https-proxy' && Date.parse(record.time) >= this.connectedAt
      && record.status === 'completed' && record.outbound?.authenticationUnchanged && record.outbound.originalsAbsent)
    if (verified && verified.time !== this.value.lastVerifiedAt) this.update({ state: 'verified', lastVerifiedAt: verified.time,
      message: '已验证请求经过本地检查，原登录认证保持不变。' })
  }
  async enable(): Promise<ProtectionSnapshot> {
    if (this.busy) throw new Error('接入操作正在进行，请稍候。')
    if (!this.value.available) throw new Error(this.value.message)
    this.busy = true
    this.update({ state: 'starting', message: '正在检查代理和证书…', lastVerifiedAt: undefined })
    let closed = false
    let touched = false
    try {
      if (!await this.services.client.executable()) throw new Error('未找到 WorkBuddy，请先安装并正常登录。')
      await this.services.proxy.start()
      if (!await this.services.checkCertificate()) {
        this.update({ message: '请完成系统证书授权，完成后会继续接入。' })
        await this.services.installCertificate()
        if (!await this.services.checkCertificate()) throw new Error('证书信任验证未通过，尚未改变 WorkBuddy 设置。')
      }
      this.update({ certificateTrusted: true, message: '正在保存原代理设置并重启 WorkBuddy…' })
      closed = await this.services.client.close()
      touched = true
      this.config.apply()
      this.update({ managed: true })
      await this.services.client.open()
      this.connectedAt = Date.now()
      this.update({ state: 'configured', clientInstalled: true, message: 'WorkBuddy 已重启。发送一条新消息后，这里会显示验证结果。' })
    } catch (error) {
      let recovered = !touched
      try {
        if (touched) {
          await this.services.client.close()
          this.config.restore()
        }
        if (closed || touched) await this.services.client.open()
        if (touched) { this.config.finishRestore(); recovered = true; this.update({ managed: false }) }
      } catch { recovered = false }
      try { if (recovered && !this.config.isConnected()) await this.services.proxy.stop() }
      catch { recovered = false }
      const message = recovered ? (error instanceof Error ? error.message : '接入未完成，原连接已保留。')
        : '接入未完成，恢复资料与代理已保留。请关闭 WorkBuddy 后点击「停止并恢复」。'
      let managed = true
      try { managed = !!this.config.backup() } catch {}
      this.update({ state: 'error', managed, message })
      throw new Error(message)
    } finally { this.busy = false }
    return this.snapshot()
  }
  async disable(): Promise<ProtectionSnapshot> {
    if (this.busy) throw new Error('接入操作正在进行，请稍候。')
    this.busy = true
    this.update({ state: 'stopping', message: '正在恢复 WorkBuddy 原连接…' })
    try {
      if (this.config.backup()) {
        const wasRunning = await this.services.client.close()
        const restored = this.config.restore()
        if (wasRunning) await this.services.client.open()
        this.config.finishRestore()
        this.update({ message: restored === 'external-change' ? '已保留后来修改的代理设置。' : 'WorkBuddy 原代理设置已恢复。' })
      } else this.update({ message: 'WorkBuddy 保护已停止。' })
      await this.services.proxy.stop()
      this.update({ state: 'off', managed: false, lastVerifiedAt: undefined })
    } catch {
      let managed = true
      try { managed = !!this.config.backup() } catch {}
      this.update({ state: 'error', managed, message: '恢复尚未完成，代理仍保留。请关闭 WorkBuddy 后重试「停止并恢复」。' })
      throw new Error(this.value.message)
    } finally { this.busy = false }
    return this.snapshot()
  }
}
