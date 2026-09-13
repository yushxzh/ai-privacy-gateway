export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export type Action = 'ALLOW' | 'MASK' | 'BLOCK' | 'ROUTE'
export type Category = 'API_KEY' | 'PRIVATE_KEY' | 'CREDENTIAL' | 'PASSWORD' | 'OAUTH_TOKEN' | 'MNEMONIC' | 'EMAIL' | 'PHONE' | 'ID_CARD' | 'ACCOUNT' | 'CUSTOM'
export type ProviderKind = 'demo' | 'client' | 'openai' | 'deepseek' | 'anthropic' | 'compatible'
export type Endpoint = 'chat/completions' | 'responses' | 'messages' | 'messages/count_tokens'
export type ClientKind =
  | 'sdk'
  | 'codex'
  | 'claude'
  | 'deepseek'
  | 'zcode'
  | 'autoclaw'
  | 'workbuddy'
  | 'traework'
  | 'codebuddy'
  | 'traecode'
  | 'opencode'
  | 'openclaw'
export type ShellKind = 'bash' | 'powershell'

export interface Settings {
  port: number
  provider: ProviderKind
  baseUrl: string
  model: string
}

export interface RecordSummary {
  id: string
  time: string
  endpoint: string
  model: string
  provider: ProviderKind
  upstreamHost?: string
  action: Action
  categories: Category[]
  findings: number
  ruleIds?: string[]
  ruleMatches?: import('./rule-settings').RuleMatch[]
  rulesRevision?: number
  transport?: 'https-proxy'
  inspectionIssue?: 'unsupported' | 'outside-scope' | 'check-failed'
  outbound?: {
    sha256: string
    bytes: number
    authenticationUnchanged: boolean
    originalsAbsent: boolean
  }
  status: 'pending' | 'completed' | 'blocked' | 'failed'
  durationMs: number
  httpStatus?: number
  note?: string
  source: 'api' | 'demo'
  stream: boolean
}

export interface RecordDetail extends RecordSummary {
  original?: string
  sanitized: string
  truncated: boolean
}

export interface Snapshot {
  running: boolean
  protection?: import('./protection').ProtectionSnapshot
  nativeHttps?: boolean
  workbuddyEnabled: boolean
  baseUrl: string
  error?: string
  settings: Settings
  hasApiKey: boolean
  records: RecordSummary[]
  counters: { total: number; masked: number; blocked: number; allowed: number; unchecked: number }
}

export interface WorkBuddyConfiguration {
  configPath: string
  models: { id: string; name: string; sourceUrl: string; connected: boolean; gatewayUrl?: string; issue?: string }[]
  error?: string
  enabled: boolean
}

export interface RuleTestResult {
  action: Action
  reason: string
  sanitized: string
  findings: { ruleId: string; category: Category; start: number; end: number; confidence: number }[]
  durationMs: number
}

export interface RuleSampleResult {
  ruleId: string
  sampleIndex: number
  passed: boolean
  result: RuleTestResult
}

export interface IntegrationGuide {
  title: string
  status: string
  steps: string[]
  code: string
  warning: string
  sourceUrl: string
}

export interface DesktopAPI {
  readonly platform: string
  readonly version: string
  setProtection(enabled: boolean): Promise<import('./protection').ProtectionSnapshot>
  removeProtection(): Promise<import('./protection').ProtectionSnapshot>
  snapshot(): Promise<Snapshot>
  record(id: string, reveal: boolean): Promise<RecordDetail | null>
  clearRecords(): Promise<void>
  setRunning(running: boolean): Promise<Snapshot>
  saveSettings(settings: Settings & { apiKey: string }): Promise<Snapshot>
  demo(text: string): Promise<void>
  guide(client: ClientKind, shell: ShellKind): Promise<IntegrationGuide>
  copy(text: string): Promise<void>
  openDocs(topic: ClientKind): Promise<void>
  openHelp(): Promise<void>
  workbuddyConfiguration(): Promise<WorkBuddyConfiguration>
  setWorkbuddyModel(id: string, enabled: boolean): Promise<WorkBuddyConfiguration>
  inspectRules(text: string): Promise<RuleTestResult>
  ruleSettings(): Promise<import('./rule-settings').RuleSettingsSnapshot>
  setRulePolicy(id: string, policy: import('./rule-settings').RulePolicy, revision: number): Promise<import('./rule-settings').RuleSettingsSnapshot>
  saveCustomRule(id: string | null, input: import('./rule-settings').CustomRuleInput, revision: number): Promise<import('./rule-settings').RuleSettingsSnapshot>
  deleteCustomRule(id: string, revision: number): Promise<import('./rule-settings').RuleSettingsSnapshot>
  testCustomRule(input: import('./rule-settings').CustomRuleInput, text: string): Promise<RuleTestResult>
  verifyRuleSamples(): Promise<RuleSampleResult[]>
  onChange(callback: () => void): () => void
}
