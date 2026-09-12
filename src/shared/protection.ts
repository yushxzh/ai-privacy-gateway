export interface ProtectionSnapshot {
  state: 'off' | 'starting' | 'configured' | 'verified' | 'stopping' | 'error'
  available: boolean
  managed: boolean
  message: string
  clientInstalled: boolean
  certificateTrusted: boolean
  lastVerifiedAt?: string
}
