import { PERSONAL_CATEGORIES, RULES, type RuleGroup } from '../shared/rules'
import type { Finding, PIIDetector, SecretDetector } from './contracts'
import { findBip39, findLabeledMnemonic } from './mnemonics'

type Pattern = { pattern: RegExp; groups?: number[]; confidence?: number }
const field = (names: string): Pattern => ({
  pattern: new RegExp('(?<![\\p{L}\\p{N}_])(?:' + names + ')["\']?\\s*[:=：]\\s*(?:"([^"\\r\\n]{1,512})"|\'([^\'\\r\\n]{1,512})\'|([^\\s"\',;，；}{&<>]{1,512}))', 'giu'),
  groups: [1, 2, 3], confidence: 0.9
})
const patterns: Record<string, Pattern[]> = {
  'private-pem': [{ pattern: /-----BEGIN ((?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?(?:-----END \1-----|$)/g }],
  'private-value': [field('(?:[a-z0-9]+_)*(?:private[_-]?key|secret[_-]?key|signing[_-]?key)|私钥|私鑰|签名密钥')],
  'api-key': [
    { pattern: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
    field('(?:[a-z0-9]+_)*(?:api[_-]?key|client[_-]?secret)|接口密钥')
  ],
  'cloud-key': [
    { pattern: /\b(?:(?:AKIA|ASIA)[A-Z0-9]{16}|LTAI[A-Za-z0-9]{12,40}|AKID[A-Za-z0-9]{16,40})\b/g },
    field('(?:[a-z0-9]+_)*(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|access[_-]?key[_-]?secret)|云访问密钥')
  ],
  'credential-url': [{ pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|ssh|sftp|ftp|https?):\/\/[^\s/@:]+:[^\s/@]+@[^\s"'<>,;，；]+/gi }],
  password: [field('(?:[a-z0-9]+_)*(?:password|passwd|pwd)|密码|密碼|口令')],
  'oauth-token': [
    { pattern: /\bBearer\s+([A-Za-z0-9._~+/%=-]{8,8192})/gi, groups: [1] },
    field('(?:[a-z0-9]+_)*(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token)|访问令牌|刷新令牌')
  ],
  jwt: [{ pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)?/g, confidence: 0.9 }],
  email: [{ pattern: /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/gi }],
  'phone-cn': [{ pattern: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d(?:[- ]?\d){8}(?!\d)/g, confidence: 0.9 }],
  'id-cn': [{ pattern: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, confidence: 0.85 }],
  account: [field('username|user_name|login|account|用户名|用戶名|账号|帐号|賬號|账户')]
}

export const DETECTOR_RULE_IDS = [...Object.keys(patterns), 'mnemonic-bip39', 'mnemonic-labeled']
function detect(text: string, group: RuleGroup, enabled?: Set<string>): Finding[] {
  return RULES.filter(rule => rule.group === group && (!enabled || enabled.has(rule.id))).flatMap(rule => {
    if (rule.id === 'mnemonic-bip39') return findBip39(text)
    if (rule.id === 'mnemonic-labeled') return findLabeledMnemonic(text)
    return patterns[rule.id].flatMap(({ pattern, groups, confidence }) => {
      return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map(match => {
        const value = groups ? groups.map(index => match[index]).find(value => value !== undefined)! : match[0]
        const start = match.index! + (groups ? match[0].lastIndexOf(value) : 0)
        return { ruleId: rule.id, category: rule.category, value, start, end: start + value.length, confidence: confidence ?? 0.98 }
      })
    })
  })
}

export class RuleSecretDetector implements SecretDetector {
  detect(text: string, enabled?: Set<string>): Finding[] { return detect(text, 'credentials', enabled) }
}
export class RulePIIDetector implements PIIDetector {
  detect(text: string, enabled?: Set<string>): Finding[] { return detect(text, 'personal', enabled) }
}
export function removeOverlaps(findings: Finding[]): Finding[] {
  const priority = (finding: Finding) => PERSONAL_CATEGORIES.includes(finding.category) ? 1 : 0
  const chosen: Finding[] = []
  for (const finding of [...findings].sort((a, b) => priority(a) - priority(b) || b.end - b.start - (a.end - a.start))) {
    if (!chosen.some(other => finding.start < other.end && finding.end > other.start)) chosen.push(finding)
  }
  return chosen.sort((a, b) => a.start - b.start)
}
