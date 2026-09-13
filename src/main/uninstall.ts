import { WorkBuddyProxySettings } from './workbuddy-proxy-settings'
import { WorkBuddyConnections } from './workbuddy-config'
import { CertificateStore } from './certificate-store'
import { WorkBuddyProcess } from './workbuddy-process'

/** 卸载仅在所有受管理连接恢复且证书撤销成功后继续；失败保留应用供重试。 */
export async function prepareUninstall(config: Pick<WorkBuddyProxySettings, 'restore' | 'finishRestore'>,
  models: Pick<WorkBuddyConnections, 'restoreAll'>, certificate: Pick<CertificateStore, 'remove'>,
  client: Pick<WorkBuddyProcess, 'close' | 'open'> = new WorkBuddyProcess()): Promise<void> {
  const wasRunning = await client.close()
  let reopened = false
  try {
    await models.restoreAll()
    config.restore()
    await certificate.remove()
    if (wasRunning) { await client.open(); reopened = true }
    config.finishRestore()
  } finally {
    if (wasRunning && !reopened) await client.open().catch(() => {})
  }
}
