export interface ProtectionSnapshot {
  state: 'off' | 'starting' | 'configured' | 'verified' | 'stopping' | 'removing' | 'error'
  available: boolean
  managed: boolean
  message: string
  clientInstalled: boolean
  certificateTrusted: boolean
  certificatePresent: boolean
  lastVerifiedAt?: string
}
