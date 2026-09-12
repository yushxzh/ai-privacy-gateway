import { EventEmitter } from 'node:events'
import type { RecordDetail, RecordSummary } from '../shared/types'

const previewLimit = 24000
function preview(text: string): string {
  if (text.length <= previewLimit) return text
  const marker = '\n\n… 中间内容已省略 …\n\n'
  const available = previewLimit - marker.length
  const head = Math.floor(available / 2)
  // Agent 的系统说明可能很长，保留末尾才能核对最新用户消息的替换结果。
  return text.slice(0, head) + marker + text.slice(-(available - head))
}

export class RecordStore extends EventEmitter {
  private entries: RecordDetail[] = []
  private counters = { total: 0, masked: 0, blocked: 0, allowed: 0 }
  private generation = 0

  add(summary: RecordSummary, original: string, sanitized: string): number {
    const truncated = original.length > previewLimit || sanitized.length > previewLimit
    this.entries.unshift({ ...summary, original: preview(original), sanitized: preview(sanitized), truncated })
    this.entries = this.entries.slice(0, 100)
    while (Buffer.byteLength(JSON.stringify(this.entries)) > 8 * 1024 * 1024) this.entries.pop()
    this.counters.total++
    if (summary.action === 'MASK') this.counters.masked++
    if (summary.action === 'BLOCK') this.counters.blocked++
    if (summary.action === 'ALLOW') this.counters.allowed++
    this.emit('change')
    return this.generation
  }

  update(id: string, generation: number, values: Partial<RecordSummary>): void {
    if (generation !== this.generation) return
    const record = this.entries.find(entry => entry.id === id)
    if (record) { Object.assign(record, values); this.emit('change') }
  }

  summaries(): RecordSummary[] {
    return this.entries.map(({ original: _original, sanitized: _sanitized, truncated: _truncated, ...summary }) => ({ ...summary }))
  }

  detail(id: string, reveal: boolean): RecordDetail | null {
    const record = this.entries.find(entry => entry.id === id)
    if (!record) return null
    return { ...record, original: reveal ? record.original : undefined }
  }

  counts() { return { ...this.counters } }

  clear(): void {
    this.generation++
    this.entries = []
    this.counters = { total: 0, masked: 0, blocked: 0, allowed: 0 }
    this.emit('change')
  }
}
