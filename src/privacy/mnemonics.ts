import { createHash } from 'node:crypto'
import wordlists from './wordlists/bip39.json'
import type { Finding } from './contracts'

const dictionaries = Object.values(wordlists).map(words => new Map(words.map((word, index) => [word.normalize('NFKD'), index])))
const lengths = [24, 21, 18, 15, 12]

function checksum(indices: number[]): boolean {
  const bits = indices.map(index => index.toString(2).padStart(11, '0')).join('')
  const entropyLength = bits.length * 32 / 33
  const checkLength = bits.length - entropyLength
  const entropy = Buffer.alloc(entropyLength / 8)
  for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const expected = createHash('sha256').update(entropy).digest()[0] >>> (8 - checkLength)
  entropy.fill(0)
  return expected === parseInt(bits.slice(entropyLength), 2)
}

export function findBip39(text: string): Finding[] {
  const words = [...text.matchAll(/[\p{L}\p{M}]+/gu)].map(match => ({
    value: match[0].normalize('NFKD').toLowerCase(), start: match.index!, end: match.index! + match[0].length
  }))
  const found: Finding[] = []
  const seen = new Set<string>()
  for (const dictionary of dictionaries) {
    let run: { index: number; start: number; end: number }[] = []
    for (const word of words) {
      const index = dictionary.get(word.value)
      if (index === undefined) { run = []; continue }
      if (run.length && !/^[\s,，、;；"'\[\]]+$/.test(text.slice(run.at(-1)!.end, word.start))) run = []
      run.push({ index, start: word.start, end: word.end })
      if (run.length > 24) run.shift()
      for (const length of lengths) {
        if (run.length < length) continue
        const candidate = run.slice(-length)
        const key = candidate[0].start + ':' + word.end
        if (seen.has(key) || !checksum(candidate.map(item => item.index))) continue
        seen.add(key)
        found.push({ ruleId: 'mnemonic-bip39', category: 'MNEMONIC', start: candidate[0].start,
          end: word.end, value: text.slice(candidate[0].start, word.end), confidence: 0.99 })
      }
    }
  }
  return found
}

export function findLabeledMnemonic(text: string): Finding[] {
  const found: Finding[] = []
  const pattern = /(?:助记词|助記詞|seed\s+phrase|recovery\s+phrase|mnemonic)\s*["']?\s*[:=：]\s*([^\r\n]{1,2048})/giu
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]
    const value = raw.trim().replace(/^["'\[\s]+|["'\]\s.。]+$/g, '')
    const words = value.match(/[\p{L}\p{M}]+/gu) ?? []
    const count = /^\p{Script=Han}+$/u.test(value) ? [...value].length : words.length
    if (count < 12 || count > 33) continue
    const start = match.index! + match[0].lastIndexOf(raw) + raw.indexOf(value)
    found.push({ ruleId: 'mnemonic-labeled', category: 'MNEMONIC', start,
      end: start + value.length, value, confidence: 0.9 })
  }
  return found
}
