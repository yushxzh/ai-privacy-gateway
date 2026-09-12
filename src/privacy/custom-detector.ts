import { Script } from 'node:vm'
import type { ManagedRule } from '../shared/rule-settings'
import type { Finding } from './contracts'
import { GatewayError } from '../gateway/errors'

// 固定程序只接收正则参数，不执行用户代码；整个匹配过程受时间与命中数量限制。
const matcher = new Script(`(() => {
  const results = texts.map(() => []);
  let count = 0;
  for (const rule of rules) {
    const regex = new RegExp(rule.expression, rule.ignoreCase ? 'giu' : 'gu');
    for (let index = 0; index < texts.length; index++) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(texts[index])) !== null) {
        if (match[0].length === 0) throw new Error('empty-match');
        if (++count > 2000) throw new Error('too-many-matches');
        results[index].push({ ruleId: rule.id, category: 'CUSTOM', start: match.index,
          end: match.index + match[0].length, value: match[0], confidence: 1, action: rule.action });
      }
    }
  }
  return results;
})()`)

export function detectCustomRules(texts: string[], rules: ManagedRule[]): Finding[][] {
  const custom = rules.filter(rule => rule.source === 'custom' && rule.enabled).map(rule => ({
    id: rule.id, action: rule.action, ignoreCase: rule.matcher!.ignoreCase,
    expression: rule.matcher!.kind === 'literal'
      ? rule.matcher!.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : rule.matcher!.pattern
  }))
  if (!custom.length) return texts.map(() => [])
  try {
    const result: Finding[][] = matcher.runInNewContext({ texts, rules: custom },
      { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } })
    return Array.from(result, findings => Array.from(findings, finding => ({ ...finding })))
  } catch (error) {
    const reason = (error as Error).message
    if (reason === 'empty-match') throw new GatewayError(422, 'invalid_rule_match', '自定义正则产生了空匹配，请修改表达式；请求尚未发送。')
    if (reason === 'too-many-matches') throw new GatewayError(422, 'rule_match_limit', '自定义规则命中超过 2,000 处，请缩小匹配范围；请求尚未发送。')
    throw new GatewayError(422, 'rule_timeout', '自定义规则检查超时，请简化或停用复杂表达式；请求尚未发送。')
  }
}
