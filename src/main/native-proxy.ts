import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { NativeBridge } from '../gateway/native-bridge'
import type { RecordStore } from '../gateway/records'
import { EventEmitter } from 'node:events'
import { RuleSettings } from '../privacy/rule-settings'

/** 本地 TLS 进程；证书授权和客户端配置由接入协调器管理。 */
export class NativeProxy extends EventEmitter {
  private bridge: NativeBridge
  private child?: ChildProcess
  private exited?: Promise<void>
  running = false
  constructor(records: RecordStore, private executable: string, private addon: string, private caDirectory: string, private port: number = 18788, rules = new RuleSettings()) {
    super()
    this.bridge = new NativeBridge(records, rules)
  }
  async start(): Promise<void> {
    if (this.running) return
    if (this.child) await this.stop()
    if (![this.executable,this.addon,this.caDirectory].every(isAbsolute)) throw new Error('HTTPS 运行时路径必须是绝对路径。')
    await this.bridge.start()
    try {
      const child = spawn(this.executable, ['--listen-host','127.0.0.1','--listen-port',String(this.port),
        '--set',`confdir=${this.caDirectory}`,'--allow-hosts','^www\\.workbuddy\\.ai:443$',
        '--set','ssl_insecure=false','--set','termlog_verbosity=error','--set','flow_detail=0','-s',this.addon],
        { stdio: 'ignore', env: { ...process.env, APG_NATIVE_BRIDGE_URL: this.bridge.url, APG_NATIVE_BRIDGE_TOKEN: this.bridge.token } })
      this.child = child
      this.exited = new Promise(resolve => {
        child.once('error', () => resolve())
        child.once('exit', () => {
          this.running = false; this.bridge.inspection.close(); this.emit('change'); resolve()
        })
      })
      await new Promise<void>((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject) })
      await Promise.race([this.bridge.waitUntilReady(), this.exited.then(() => { throw new Error('TLS 代理启动失败。') })])
      this.running = true
      this.emit('change')
    } catch (error) { await this.stop(); throw error }
  }
  async stop(): Promise<void> {
    await this.bridge.stop()
    const child = this.child
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await this.exited
      clearTimeout(timer)
    }
    this.child = undefined
    this.running = false
    this.emit('change')
  }
}
