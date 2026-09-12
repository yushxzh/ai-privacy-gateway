import { PrivacyPipeline } from './pipeline'
import { RuleSettings } from './rule-settings'
import type { CustomRuleInput } from '../shared/rule-settings'
import type { RuleTestResult } from '../shared/types'
import { GatewayError } from '../gateway/errors'

/** 编辑中的规则仅在内存中验证，不保存配置，不产生网关请求记录。 */
export async function previewCustomRule(input: CustomRuleInput, text: string): Promise<RuleTestResult> {
  if (typeof text !== 'string' || !text.trim() || text.length > 12000)
    throw new GatewayError(400, 'invalid_test_text', '请输入 1–12,000 个字符进行本地测试。')
  const rules = new RuleSettings()
  for (const rule of rules.snapshot().rules)
    rules.setPolicy(rule.id, { enabled: false, action: 'MASK' }, rules.snapshot().revision)
  rules.saveCustom(null, input, rules.snapshot().revision)
  const pipeline = new PrivacyPipeline(undefined, undefined, undefined, undefined, rules)
  const started = performance.now()
  const result = await pipeline.process([text])
  try {
    return { action: result.decision.action, reason: result.decision.reason, sanitized: result.sanitized[0],
      findings: result.findings.map(({ value: _value, ...finding }) => finding), durationMs: Math.round(performance.now() - started) }
  } finally { result.pseudonymizer.clear() }
}
