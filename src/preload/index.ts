import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/types'
import { version } from '../../package.json'

const api: DesktopAPI = {
  platform: process.platform,
  version,
  setProtection: enabled => ipcRenderer.invoke('privacy:protection', enabled),
  removeProtection: () => ipcRenderer.invoke('privacy:protection-remove'),
  snapshot: () => ipcRenderer.invoke('privacy:snapshot'),
  record: (id, reveal) => ipcRenderer.invoke('privacy:record', id, reveal),
  clearRecords: () => ipcRenderer.invoke('privacy:clear'),
  setRunning: running => ipcRenderer.invoke('privacy:running', running),
  saveSettings: settings => ipcRenderer.invoke('privacy:settings', settings),
  demo: text => ipcRenderer.invoke('privacy:demo', text),
  guide: (client, shell) => ipcRenderer.invoke('privacy:guide', client, shell),
  copy: text => ipcRenderer.invoke('privacy:copy', text),
  openDocs: topic => ipcRenderer.invoke('privacy:docs', topic),
  openHelp: () => ipcRenderer.invoke('privacy:help'),
  workbuddyConfiguration: () => ipcRenderer.invoke('privacy:workbuddy'),
  setWorkbuddyModel: (id, enabled) => ipcRenderer.invoke('privacy:workbuddy-model', id, enabled),
  inspectRules: text => ipcRenderer.invoke('privacy:rules-inspect', text),
  ruleSettings: () => ipcRenderer.invoke('privacy:rules-settings'),
  setRulePolicy: (id, policy, revision) => ipcRenderer.invoke('privacy:rules-policy', id, policy, revision),
  saveCustomRule: (id, input, revision) => ipcRenderer.invoke('privacy:rules-save', id, input, revision),
  deleteCustomRule: (id, revision) => ipcRenderer.invoke('privacy:rules-delete', id, revision),
  testCustomRule: (input, text) => ipcRenderer.invoke('privacy:rules-preview', input, text),
  verifyRuleSamples: () => ipcRenderer.invoke('privacy:rules-samples'),
  onChange: callback => {
    const listener = () => callback()
    ipcRenderer.on('privacy:changed', listener)
    return () => ipcRenderer.removeListener('privacy:changed', listener)
  }
}
contextBridge.exposeInMainWorld('privacy', api)
