import type { Category } from './types'

export type RuleAction = 'MASK' | 'BLOCK'
export interface RulePolicy { enabled: boolean; action: RuleAction }
export interface CustomRuleInput extends RulePolicy {
  name: string
  kind: 'literal' | 'regex'
  pattern: string
  ignoreCase: boolean
}
export interface CustomRule extends CustomRuleInput { id: string }
export interface ManagedRule extends RulePolicy {
  id: string
  name: string
  source: 'builtin' | 'custom'
  category: Category
  description: string
  boundary: string
  matcher?: Pick<CustomRuleInput, 'kind' | 'pattern' | 'ignoreCase'>
}
export interface RuleSettingsSnapshot {
  revision: number
  rules: ManagedRule[]
  error?: string
}
export interface RuleMatch {
  id: string
  name: string
  source: 'builtin' | 'custom'
  action: RuleAction
}
