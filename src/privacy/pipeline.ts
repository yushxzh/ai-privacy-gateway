import { createHmac, randomBytes } from 'node:crypto'
import type { Json } from '../shared/types'
import type { Finding, PolicyDecision, PolicyEngine, ReversiblePseudonymizer, SemanticClassifier, SemanticResult } from './contracts'
import { removeOverlaps, RulePIIDetector, RuleSecretDetector } from './detectors'
import { RuleSettings } from './rule-settings'
import { detectCustomRules } from './custom-detector'
import type { RuleMatch } from '../shared/rule-settings'

export class DisabledSemanticClassifier implements SemanticClassifier {
  readonly enabled = false
  async classify(): Promise<SemanticResult[]> { return [] }
}

export class DefaultPolicyEngine implements PolicyEngine {
  decide(findings: Finding[]): PolicyDecision {
    if (findings.some(f => f.action === 'BLOCK')) {
      return { action: 'BLOCK', reason: '命中了设置为「阻断」的规则，请求未发送。可在「规则」中修改处理动作。' }
    }
    if (findings.length) return { action: 'MASK', reason: '已按规则将识别到的敏感内容替换为代号。' }
    return { action: 'ALLOW', reason: '当前规则未发现敏感信息。' }
  }
}

export class RequestPseudonymizer implements ReversiblePseudonymizer {
  private key = randomBytes(32)
  private mapping = new Map<string, string>()

  replace(text: string, findings: Finding[]): string {
    let result = text
    for (const finding of [...findings].reverse()) {
      const digest = createHmac('sha256', this.key).update(finding.category + ':' + finding.value).digest('hex').slice(0, 16)
      const alias = `⟦${finding.category}_${digest}⟧`
      this.mapping.set(alias, finding.value)
      result = result.slice(0, finding.start) + alias + result.slice(finding.end)
    }
    return result
  }

  restore(value: Json): Json {
    let bytes = 0
    const limit = 8 * 1024 * 1024
    const restoreValue = (item: Json): Json => {
      if (typeof item === 'string') {
        bytes += Buffer.byteLength(item)
        if (bytes > limit) throw new Error('恢复后的响应超过内存限制。')
        return item.replace(/⟦[A-Z_]+_[a-f0-9]{16}⟧/g, alias => {
          const original = this.mapping.get(alias) ?? alias
          bytes += Buffer.byteLength(original) - Buffer.byteLength(alias)
          if (bytes > limit) throw new Error('恢复后的响应超过内存限制。')
          return original
        })
      }
      if (Array.isArray(item)) return item.map(restoreValue)
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, restoreValue(child)]))
      return item
    }
    return restoreValue(value)
  }

  clear(): void { this.mapping.clear(); this.key.fill(0) }
}

export class PrivacyPipeline {
  constructor(
    private secrets = new RuleSecretDetector(),
    private pii = new RulePIIDetector(),
    private policy: PolicyEngine = new DefaultPolicyEngine(),
    private semantic: SemanticClassifier = new DisabledSemanticClassifier(),
    private rules: RuleSettings = new RuleSettings()
  ) {}

  async process(texts: string[]) {
    const pseudonymizer = new RequestPseudonymizer()
    try {
      const settings = this.rules.current()
      const enabled = new Set(settings.rules.filter(rule => rule.enabled).map(rule => rule.id))
      const byId = new Map(settings.rules.map(rule => [rule.id, rule]))
      const custom = detectCustomRules(texts, settings.rules)
      const builtin = texts.map(text => [...this.secrets.detect(text, enabled), ...this.pii.detect(text, enabled)])
      const hits = texts.map((_text, index) => [...builtin[index], ...custom[index]]
        .map(finding => ({ ...finding, action: byId.get(finding.ruleId)!.action })))
      // 先判断全部规则的动作，再合并替换范围；短规则的阻断不能被长规则覆盖。
      const findings = texts.map((text, index) => mergeFindings(text, [...removeOverlaps(builtin[index]), ...custom[index]]))
      const semantics = this.semantic.enabled ? await this.semantic.classify(texts.join('\n')) : []
      const decision = this.policy.decide(hits.flat(), semantics)
      const sanitized = texts.map((text, i) => pseudonymizer.replace(text, findings[i]))
      const ruleMatches: RuleMatch[] = [...new Set(hits.flat().map(hit => hit.ruleId))].map(id => {
        const rule = byId.get(id)!
        return { id, name: rule.name, source: rule.source, action: rule.action }
      })
      return { sanitized, findings: findings.flat(), ruleMatches, rulesRevision: settings.revision, decision, pseudonymizer }
    } catch (error) {
      pseudonymizer.clear()
      throw error
    }
  }
}

function mergeFindings(text: string, findings: Finding[]): Finding[] {
  const merged: Finding[] = []
  for (const finding of [...findings].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged.at(-1)
    if (previous && finding.start < previous.end) {
      previous.end = Math.max(previous.end, finding.end)
      previous.value = text.slice(previous.start, previous.end)
    } else merged.push({ ...finding })
  }
  return merged
}
