import { open, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type { WorkBuddyConfiguration } from '../shared/types'
import { GatewayError } from '../gateway/errors'
import { validateWorkBuddyUrl, type WorkBuddyRoute } from '../gateway/workbuddy'
import type { PrivacyGateway } from '../gateway/server'

const capabilityKeys = ['supportsToolCall', 'supportsImages', 'supportsReasoning', 'useCustomProtocol'] as const
type Capability = typeof capabilityKeys[number]
type SavedRoute = { id: string; token: string; url: string; capabilities: Partial<Record<Capability, boolean>> }
type CustomModel = Record<string, unknown> & { id: string; url: string }
const applied = { supportsToolCall: false, supportsImages: false, supportsReasoning: false, useCustomProtocol: true }

async function readBounded(path: string) {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('invalid-config')
    const raw = await file.readFile('utf8')
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('invalid-config')
    return raw
  } finally { await file.close() }
}

async function readDocument(path: string) {
  const raw = await readBounded(path)
  const data = JSON.parse(raw)
  const models = Array.isArray(data) ? data : data?.models
  if (!Array.isArray(models) || models.length > 100) throw new Error('invalid-config')
  return { raw, data, models }
}

async function writeAtomic(path: string, data: unknown, expected?: string) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    if (expected !== undefined && await readFile(path, 'utf8') !== expected)
      throw new GatewayError(409, 'workbuddy_config_changed', 'WorkBuddy 配置刚刚发生变化，请重新检查。')
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

function isCustomModel(model: unknown): model is CustomModel {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return false
  const row = model as Record<string, unknown>
  // 此文件由 WorkBuddy 的自定义模型表单维护，供应商预设也属于自定义 API。
  // 显式的内置标记不接管；不读取或修改 WorkBuddy 的内置账号和模型设置。
  return row.builtin !== true && row.isBuiltin !== true && row.type !== 'builtin'
    && typeof row.id === 'string' && /^[A-Za-z0-9_.:/-]{1,120}$/.test(row.id)
    && typeof row.url === 'string'
}

function localToken(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.search || url.hash)
      return undefined
    return url.pathname.match(/^\/workbuddy\/([a-f0-9]{64})\/v1\/chat\/completions$/)?.[1]
  } catch { return undefined }
}

function endpoint(url: string, customProtocol: boolean, port: number): string {
  const target = validateWorkBuddyUrl(url, port)
  if (!customProtocol && !target.pathname.replace(/\/$/, '').endsWith('/chat/completions'))
    target.pathname = target.pathname.replace(/\/$/, '') + '/chat/completions'
  return target.href
}

function capabilities(model: CustomModel): SavedRoute['capabilities'] {
  const result: SavedRoute['capabilities'] = {}
  for (const key of capabilityKeys) {
    if (key in model && typeof model[key] !== 'boolean') throw new Error('invalid-capability')
    if (typeof model[key] === 'boolean') result[key] = model[key]
  }
  return result
}

export class WorkBuddyConnections {
  private updates = Promise.resolve<unknown>(undefined)

  constructor(readonly configPath: string, readonly statePath: string, private gateway: PrivacyGateway) {}

  private async saved(): Promise<SavedRoute[]> {
    try {
      const data = JSON.parse(await readBounded(this.statePath))
      if (data.version !== 1 || !Array.isArray(data.routes) || data.routes.length > 100) throw new Error('invalid-state')
      const ids = new Set<string>()
      const tokens = new Set<string>()
      return data.routes.map((row: SavedRoute) => {
        if (!row || typeof row.id !== 'string' || typeof row.url !== 'string'
          || !/^[a-f0-9]{64}$/.test(row.token) || ids.has(row.id) || tokens.has(row.token)
          || !row.capabilities || Object.keys(row.capabilities).some(key => !capabilityKeys.includes(key as Capability)))
          throw new Error('invalid-state')
        ids.add(row.id); tokens.add(row.token)
        validateWorkBuddyUrl(row.url, this.gateway.snapshot().settings.port)
        const restored = capabilities({ ...row.capabilities, id: row.id, url: row.url })
        return { id: row.id, url: row.url, token: row.token, capabilities: restored }
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new GatewayError(409, 'workbuddy_state_invalid', '本地接入资料无法读取，请先在 WorkBuddy 恢复原模型地址，再重新接入。')
    }
  }

  private source(model: CustomModel, saved: SavedRoute[]): SavedRoute {
    const token = localToken(model.url)
    if (token) {
      const previous = saved.find(row => row.id === model.id && row.token === token)
      if (previous) return previous
      // 0.1.3 只有固定 DeepSeek 来源；仅对该旧入口做有依据的迁移。
      if (/^(?:custom:)?deepseek-[a-z0-9.-]+$/.test(model.id))
        return { id: model.id, token, url: 'https://api.deepseek.com/chat/completions', capabilities: capabilities(model) }
      throw new GatewayError(409, 'workbuddy_source_missing', '没有找到原服务地址，请先在 WorkBuddy 恢复模型 API 地址。')
    }
    validateWorkBuddyUrl(model.url, this.gateway.snapshot().settings.port)
    return { id: model.id, token: randomBytes(32).toString('hex'), url: model.url, capabilities: capabilities(model) }
  }

  configuration(): Promise<WorkBuddyConfiguration> {
    const next = this.updates.then(() => this.readConfiguration())
    this.updates = next.catch(() => {})
    return next
  }

  private async readConfiguration(): Promise<WorkBuddyConfiguration> {
    const result: WorkBuddyConfiguration = { configPath: this.configPath, models: [], enabled: false }
    const active: WorkBuddyRoute[] = []
    try {
      const [{ models }, saved] = await Promise.all([readDocument(this.configPath), this.saved()])
      const rows = models.filter(isCustomModel)
      for (const model of rows) {
        const metadata: WorkBuddyConfiguration['models'][number] = {
          id: model.id, name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
          sourceUrl: '', connected: false
        }
        try {
          if (rows.filter(row => row.id === model.id).length !== 1)
            throw new GatewayError(409, 'duplicate_model', '存在重复模型 ID，请先在 WorkBuddy 中区分模型名称。')
          const source = this.source(model, saved)
          metadata.sourceUrl = source.url
          const known = saved.some(row => row.id === model.id && row.token === source.token)
          const expected = this.gateway.workbuddyUrl(source.token)
          metadata.connected = known && model.url === expected
          if (metadata.connected) {
            metadata.gatewayUrl = expected
            active.push({ id: model.id.replace(/^custom:/, ''), token: source.token,
              url: endpoint(source.url, source.capabilities.useCustomProtocol === true, this.gateway.snapshot().settings.port) })
          }
        } catch (error) {
          metadata.issue = error instanceof GatewayError ? error.message : '模型配置格式有误，请在 WorkBuddy 中重新保存。'
        }
        result.models.push(metadata)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        result.error = error instanceof GatewayError ? error.message : '无法读取 WorkBuddy 自定义模型配置，请保存后重新检查。'
    }
    this.gateway.setWorkbuddyRoutes(active)
    result.enabled = active.length > 0
    return result
  }

  setModel(id: string, enabled: boolean): Promise<WorkBuddyConfiguration> {
    const next = this.updates.then(() => this.change(id, enabled))
    this.updates = next.catch(() => {})
    return next
  }

  restoreAll(): Promise<void> {
    const next = this.updates.then(async () => {
      const saved = await this.saved()
      let document: Awaited<ReturnType<typeof readDocument>>
      try { document = await readDocument(this.configPath) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new GatewayError(409, 'workbuddy_config_invalid', 'WorkBuddy 模型配置无法读取，请先恢复配置后再卸载。')
        await rm(this.statePath, { force: true })
        return
      }
      const rows = document.models.filter(isCustomModel)
      let changed = false
      for (const model of rows) {
        const token = localToken(model.url)
        if (!token) continue
        if (rows.filter(row => row.id === model.id).length !== 1)
          throw new GatewayError(409, 'workbuddy_duplicate_model', '模型 ID 重复，请在 WorkBuddy 恢复原模型地址后再卸载。')
        const source = saved.find(row => row.id === model.id && row.token === token)
        if (!source) throw new GatewayError(409, 'workbuddy_source_missing', '模型原连接资料缺失，请在 WorkBuddy 恢复原模型地址后再卸载。')
        model.url = source.url
        for (const key of capabilityKeys) {
          if (model[key] !== applied[key]) continue
          if (key in source.capabilities) model[key] = source.capabilities[key]
          else delete model[key]
        }
        changed = true
      }
      if (changed) await writeAtomic(this.configPath, document.data, document.raw)
      await rm(this.statePath, { force: true })
      this.gateway.setWorkbuddyRoutes([])
    })
    this.updates = next.catch(() => {})
    return next
  }

  private async change(id: string, enabled: boolean): Promise<WorkBuddyConfiguration> {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('invalid-argument')
    const { raw, data, models } = await readDocument(this.configPath)
    const matches = models.filter(isCustomModel).filter(model => model.id === id)
    if (matches.length !== 1)
      throw new GatewayError(409, 'workbuddy_not_configured', '请先在 WorkBuddy 保存唯一的自定义模型，再重新检查。')
    const model = matches[0]
    const saved = await this.saved()
    if (enabled) {
      const source = this.source(model, saved)
      endpoint(source.url, source.capabilities.useCustomProtocol === true, this.gateway.snapshot().settings.port)
      // 先保存恢复信息；其中没有 apiKey。配置写入失败时不启用连接，也不会丢失原地址。
      const currentIds = new Set(models.filter(isCustomModel).map(model => model.id))
      const routes = saved.filter(row => row.id !== id && currentIds.has(row.id)).concat(source)
      await writeAtomic(this.statePath, { version: 1, routes })
      Object.assign(model, applied, { url: this.gateway.workbuddyUrl(source.token) })
    } else {
      const source = saved.find(row => row.id === id && row.token === localToken(model.url))
      if (!source) throw new GatewayError(409, 'workbuddy_config_changed', '模型地址已在 WorkBuddy 中改变，请重新检查。')
      model.url = source.url
      for (const key of capabilityKeys) {
        if (model[key] !== applied[key]) continue
        if (key in source.capabilities) model[key] = source.capabilities[key]
        else delete model[key]
      }
    }
    await writeAtomic(this.configPath, data, raw)
    return this.readConfiguration()
  }
}
