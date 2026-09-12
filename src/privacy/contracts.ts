import type { Action, Category, Endpoint, Json, ProviderKind } from '../shared/types'

export interface Finding {
  ruleId: string
  category: Category
  start: number
  end: number
  value: string
  confidence: number
  action?: import('../shared/rule-settings').RuleAction
}

export interface SecretDetector {
  detect(text: string): Finding[]
}

export interface PIIDetector {
  detect(text: string): Finding[]
}

export interface SemanticResult {
  category: string
  confidence: number
  recommendedAction: Action
}

export interface SemanticClassifier {
  readonly enabled: boolean
  classify(text: string): Promise<SemanticResult[]>
}

export interface PolicyDecision {
  action: Action
  reason: string
  routeTo?: string
}

export interface PolicyEngine {
  decide(findings: Finding[], semantic: SemanticResult[]): PolicyDecision
}

export interface ReversiblePseudonymizer {
  replace(text: string, findings: Finding[]): string
  restore(value: Json): Json
  clear(): void
}

export interface ProviderTarget {
  kind: ProviderKind
  url: string | null
  apiKey: string
}

export interface ProviderRouter {
  resolve(endpoint: Endpoint, decision: PolicyDecision): ProviderTarget
}
