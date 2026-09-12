import { CheckCheck, LoaderCircle, Plug, ShieldCheck, Undo2 } from 'lucide-react'
import type { ProtectionSnapshot } from '../../shared/protection'

const labels = { off: '未开启', starting: '正在接入', configured: '已配置 · 等待请求', verified: '已验证', stopping: '正在恢复', error: '需要处理' }
export function ProtectionPanel({ value, busy, change }: {
  value?: ProtectionSnapshot
  busy: boolean
  change(enabled: boolean): void
}) {
  if (!value) return null
  const pending = busy || value.state === 'starting' || value.state === 'stopping'
  const active = value.state === 'configured' || value.state === 'verified'
  return <section className="panel native-connection" aria-label="WorkBuddy 一键接入">
    <div className="native-connection-heading">
      <div className="native-connection-icon"><ShieldCheck size={23} /></div>
      <div className="native-connection-title"><h2>WorkBuddy</h2><p>沿用原订阅、登录和模型</p></div>
      <span className={`connection-state connection-${value.state}`}>
        {value.state === 'verified' ? <CheckCheck size={15} /> : pending ? <LoaderCircle className="spin" size={15} /> : null}{labels[value.state]}
      </span>
    </div>
    <div className="native-connection-body">
      <p aria-live="polite">{value.message}</p>
      {value.lastVerifiedAt && <small>最近验证：{new Date(value.lastVerifiedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small>}
      {!value.clientInstalled && value.available && <p className="inline-error">未检测到 WorkBuddy。安装并登录后，重新打开网关。</p>}
    </div>
    <div className="native-connection-footer">
      <p>开启和恢复会重启 WorkBuddy，请先保存任务。首次开启需要系统证书授权；正常退出网关时恢复原代理设置。</p>
      <div className="native-connection-actions">
        {(value.managed || active) && <button className="button" disabled={pending} onClick={() => change(false)}><Undo2 size={15} />停止并恢复</button>}
        {!active && <button className="button primary" disabled={pending || !value.available || !value.clientInstalled} onClick={() => change(true)}>
          <Plug size={16} />{value.state === 'error' ? '重试开启' : '一键开启保护'}
        </button>}
      </div>
    </div>
  </section>
}
