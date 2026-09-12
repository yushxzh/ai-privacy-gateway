import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const WORKBUDDY_PROXY = 'http://127.0.0.1:18788'
const fields = ['http.proxy', 'http.proxySupport'] as const
type ProxyFields = Partial<Record<typeof fields[number], string>>
export interface ConnectionBackup { schema: 1; original: ProxyFields; applied: boolean }
const target: ProxyFields = { 'http.proxy': WORKBUDDY_PROXY, 'http.proxySupport': 'override' }

function readJson(path: string, optional = false): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape')
    return value as Record<string, unknown>
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('无法读取 WorkBuddy 接入配置，请检查文件后重试。')
  }
}
function proxyFields(value: Record<string, unknown>): ProxyFields {
  const result: ProxyFields = {}
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) continue
    if (typeof value[key] !== 'string' || value[key].length > 4096) throw new Error('WorkBuddy 代理字段格式不受支持。')
    result[key] = value[key]
  }
  return result
}
export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = path + '.' + randomUUID() + '.tmp'
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, path) }
  finally { rmSync(temp, { force: true }) }
}
const same = (left: ProxyFields, right: ProxyFields) => fields.every(key => left[key] === right[key])

/** 只覆盖代理字段，恢复时保留 WorkBuddy 或用户期间改动的其他设置。 */
export class WorkBuddyProxySettings {
  constructor(readonly settingsPath: string, readonly backupPath: string) {}
  isConnected(): boolean { return same(proxyFields(readJson(this.settingsPath, true)), target) }
  backup(): ConnectionBackup | undefined {
    const value = readJson(this.backupPath, true)
    if (!Object.keys(value).length) return undefined
    if (value.schema !== 1 || typeof value.applied !== 'boolean' || !value.original || typeof value.original !== 'object' || Array.isArray(value.original))
      throw new Error('接入恢复资料损坏，请先修复连接备份。')
    return { schema: 1, applied: value.applied, original: proxyFields(value.original as Record<string, unknown>) }
  }
  apply(): void {
    const current = readJson(this.settingsPath, true)
    const original = proxyFields(current)
    let backup = this.backup()
    if (backup && !same(original, target) && !same(original, backup.original))
      throw new Error('WorkBuddy 代理已被其他设置修改，请先恢复本次接入再重新开启。')
    if (!backup) {
      // 旧版本手动接入没有恢复资料，沿用既有约定：停止后直接连接。
      backup = { schema: 1, applied: false, original: same(original, target) ? { 'http.proxy': '', 'http.proxySupport': 'off' } : original }
      writePrivateJson(this.backupPath, backup)
    }
    writePrivateJson(this.settingsPath, { ...current, ...target })
    writePrivateJson(this.backupPath, { ...backup, applied: true })
  }
  restore(): 'restored' | 'external-change' | 'nothing' {
    const backup = this.backup()
    if (!backup) return 'nothing'
    const current = readJson(this.settingsPath, true)
    const configured = proxyFields(current)
    if (same(configured, target)) {
      for (const key of fields) delete current[key]
      Object.assign(current, backup.original)
      writePrivateJson(this.settingsPath, current)
      return 'restored'
    }
    return same(configured, backup.original) ? 'restored' : 'external-change'
  }
  finishRestore(): void { rmSync(this.backupPath, { force: true }) }
}
