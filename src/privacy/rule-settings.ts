import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { RULES } from '../shared/rules'
import type { CustomRule, CustomRuleInput, RulePolicy, RuleSettingsSnapshot } from '../shared/rule-settings'
import { GatewayError } from '../gateway/errors'

interface StoredRules {
  schema: 1
  revision: number
  overrides: Record<string, RulePolicy>
  custom: CustomRule[]
}
const failure = (message: string) => new GatewayError(400, 'invalid_rule', message)
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function validatePolicy(value: unknown): RulePolicy {
  if (!isObject(value) || typeof value.enabled !== 'boolean' || !['MASK', 'BLOCK'].includes(String(value.action)))
    throw failure('请选择启用状态，以及「替换」或「阻断」动作。')
  return { enabled: value.enabled, action: value.action as RulePolicy['action'] }
}
export function validateCustomRule(value: unknown): CustomRuleInput {
  const policy = validatePolicy(value)
  if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 60)
    throw failure('规则名称需要 1–60 个字符。')
  if (!['literal', 'regex'].includes(String(value.kind)) || typeof value.pattern !== 'string' ||
      !value.pattern.trim() || value.pattern.length > 512 || typeof value.ignoreCase !== 'boolean')
    throw failure('请填写 1–512 个字符的匹配内容，并选择匹配方式。')
  if (value.kind === 'regex') {
    try { new RegExp(value.pattern, value.ignoreCase ? 'giu' : 'gu') }
    catch { throw failure('正则表达式格式无效，请检查括号、转义和字符范围。') }
  }
  return { ...policy, name: value.name.trim(), kind: value.kind as CustomRuleInput['kind'], pattern: value.pattern, ignoreCase: value.ignoreCase }
}

/** 内置覆盖设置与用户规则分开保存；两个网关共用同一个实例。 */
export class RuleSettings extends EventEmitter {
  private data: StoredRules = { schema: 1, revision: 0, overrides: {}, custom: [] }
  private error?: string
  constructor(private path?: string) {
    super()
    if (!path) return
    try {
      if (statSync(path).size > 256 * 1024) throw new Error('oversized')
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (!isObject(value) || value.schema !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
          !isObject(value.overrides) || !Array.isArray(value.custom) || value.custom.length > 100) throw new Error('invalid')
      const overrides: Record<string, RulePolicy> = {}
      for (const [id, policy] of Object.entries(value.overrides)) {
        if (!RULES.some(rule => rule.id === id)) throw new Error('unknown-rule')
        overrides[id] = validatePolicy(policy)
      }
      const ids = new Set<string>()
      const custom = value.custom.map(item => {
        if (!isObject(item) || typeof item.id !== 'string' || !/^custom-[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw new Error('invalid-id')
        ids.add(item.id)
        return { ...validateCustomRule(item), id: item.id }
      })
      this.data = { schema: 1, revision: Number(value.revision), overrides, custom }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.error = '无法读取本地规则配置。请求检查已暂停，请修复 rule-settings.json 后重启应用。'
    }
  }
  snapshot(): RuleSettingsSnapshot {
    return { revision: this.data.revision, error: this.error, rules: [
      ...RULES.map(rule => ({ id: rule.id, name: rule.name, category: rule.category, source: 'builtin' as const,
        description: rule.description, boundary: rule.boundary,
        ...(this.data.overrides[rule.id] ?? { enabled: true, action: 'MASK' as const }) })),
      ...this.data.custom.map(rule => ({ id: rule.id, name: rule.name, category: 'CUSTOM' as const, source: 'custom' as const,
        description: rule.kind === 'literal' ? '匹配指定文本。' : '匹配正则表达式，替换整个匹配片段。', boundary: '',
        enabled: rule.enabled, action: rule.action, matcher: { kind: rule.kind, pattern: rule.pattern, ignoreCase: rule.ignoreCase } }))
    ] }
  }
  current(): RuleSettingsSnapshot {
    if (this.error) throw new GatewayError(503, 'rules_unavailable', this.error)
    return this.snapshot()
  }
  private commit(next: StoredRules, expectedRevision: number): RuleSettingsSnapshot {
    this.current()
    if (expectedRevision !== this.data.revision) throw failure('规则已发生变化，请刷新后重新保存。')
    next.revision = this.data.revision + 1
    if (this.path) {
      const temporary = this.path + '.' + randomUUID() + '.tmp'
      try {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
        writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
        renameSync(temporary, this.path)
      } catch {
        throw new GatewayError(500, 'rules_save_failed', '规则保存失败，原设置仍然有效。请检查本地目录的写入权限。')
      } finally { rmSync(temporary, { force: true }) }
    }
    this.data = next
    this.emit('change')
    return this.snapshot()
  }
  setPolicy(id: string, policy: RulePolicy, revision: number): RuleSettingsSnapshot {
    const validated = validatePolicy(policy)
    const next = structuredClone(this.data)
    if (RULES.some(rule => rule.id === id)) next.overrides[id] = validated
    else {
      const custom = next.custom.find(rule => rule.id === id)
      if (!custom) throw failure('规则不存在，请刷新列表。')
      Object.assign(custom, validated)
    }
    return this.commit(next, revision)
  }
  saveCustom(id: string | null, input: CustomRuleInput, revision: number): RuleSettingsSnapshot {
    const validated = validateCustomRule(input)
    const next = structuredClone(this.data)
    if (id !== null) {
      const index = next.custom.findIndex(rule => rule.id === id)
      if (index < 0) throw failure('自定义规则不存在，请刷新列表。')
      next.custom[index] = { ...validated, id }
    } else {
      if (next.custom.length >= 100) throw failure('最多保存 100 条自定义规则，请先整理已有规则。')
      next.custom.push({ ...validated, id: 'custom-' + randomUUID() })
    }
    return this.commit(next, revision)
  }
  deleteCustom(id: string, revision: number): RuleSettingsSnapshot {
    if (!this.data.custom.some(rule => rule.id === id)) throw failure('只能删除已有的自定义规则。')
    const next = structuredClone(this.data)
    next.custom = next.custom.filter(rule => rule.id !== id)
    return this.commit(next, revision)
  }
}
