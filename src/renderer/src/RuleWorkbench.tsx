import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { CATEGORY_NAMES } from '../../shared/rules'
import type { CustomRuleInput, ManagedRule, RulePolicy, RuleSettingsSnapshot } from '../../shared/rule-settings'
import type { RuleTestResult } from '../../shared/types'

const blankRule = (): CustomRuleInput => ({ name: '', kind: 'literal', pattern: '', ignoreCase: false, enabled: true, action: 'MASK' })
const messageOf = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作未完成，请重试。'

export function RuleWorkbench() {
  const [snapshot, setSnapshot] = useState<RuleSettingsSnapshot>()
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ id: string | null; revision: number }>()
  const [draft, setDraft] = useState<CustomRuleInput>(blankRule)
  const [testText, setTestText] = useState('')
  const [result, setResult] = useState<RuleTestResult>()
  const [deleting, setDeleting] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAfterClose = useRef(false)
  const applySnapshot = (next: RuleSettingsSnapshot) => setSnapshot(previous => !previous || next.revision >= previous.revision ? next : previous)
  useEffect(() => {
    let live = true
    const refresh = () => void window.privacy.ruleSettings().then(value => { if (live) applySnapshot(value) })
      .catch(() => { if (live) setError('无法读取规则，请重新打开此页面。') })
    refresh()
    const unsubscribe = window.privacy.onChange(refresh)
    return () => { live = false; unsubscribe() }
  }, [])
  useEffect(() => { if (editor) nameInput.current?.focus() }, [editor])
  useEffect(() => {
    if (!editor && !busy && focusAfterClose.current) { addButton.current?.focus(); focusAfterClose.current = false }
  }, [editor, busy])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  async function save(operation: () => Promise<RuleSettingsSnapshot>, after?: () => void) {
    setBusy(true); setError(''); setNotice('')
    try {
      applySnapshot(await operation())
      setNotice('已保存，从下一条请求开始生效。')
      after?.()
    } catch (error) {
      setError(messageOf(error))
      void window.privacy.ruleSettings().then(applySnapshot).catch(() => {})
    } finally { setBusy(false) }
  }
  function openEditor(rule?: ManagedRule) {
    if (!snapshot) return
    setDraft(rule?.matcher ? { ...rule.matcher, name: rule.name, enabled: rule.enabled, action: rule.action } : blankRule())
    setEditor({ id: rule?.id ?? null, revision: snapshot.revision })
    setTestText(''); setResult(undefined); setError(''); setNotice(''); setDeleting(undefined)
  }
  function closeEditor() { focusAfterClose.current = true; setEditor(undefined); setResult(undefined); setTestText(''); setError('') }
  function changeDraft(patch: Partial<CustomRuleInput>) { setDraft({ ...draft, ...patch }); setResult(undefined); setError('') }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (editor) void save(() => window.privacy.saveCustomRule(editor.id, draft, editor.revision), closeEditor)
  }
  function setPolicy(rule: ManagedRule, patch: Partial<RulePolicy>) {
    if (snapshot) void save(() => window.privacy.setRulePolicy(rule.id,
      { enabled: rule.enabled, action: rule.action, ...patch }, snapshot.revision))
  }
  async function testDraft() {
    setBusy(true); setError(''); setResult(undefined)
    try { setResult(await window.privacy.testCustomRule(draft, testText)) }
    catch (error) { setError(messageOf(error)) }
    finally { setBusy(false) }
  }
  if (!snapshot) return <p role="status">正在读取规则…</p>
  const visible = snapshot.rules.filter(rule => (filter === 'all' || filter === rule.source)
    && (rule.name + CATEGORY_NAMES[rule.category]).toLowerCase().includes(search.trim().toLowerCase()))
  const locked = busy || !!snapshot.error
  return (
    <div className="managed-rules">
      <div className="page-heading">
        <div><h1>规则</h1><p>选择敏感内容的处理方式，也可以添加自己的匹配规则。</p></div>
        <button ref={addButton} className="button primary" disabled={locked || !!editor} onClick={() => openEditor()}>
          <Plus size={16} />新增规则
        </button>
      </div>
      {(error || snapshot.error) && <p className="notice error" role="alert">{error || snapshot.error}</p>}
      <div className="rule-save-notice" role="status" aria-live="polite">{notice && <><Check size={15} />{notice}</>}</div>
      {editor && <form className="custom-rule-form" aria-label={editor.id ? '编辑自定义规则' : '新增自定义规则'} onSubmit={submit}>
        <div className="rule-editor-heading"><h2>{editor.id ? '编辑规则' : '新增规则'}</h2>
          <button type="button" className="icon-button" aria-label="关闭规则编辑" disabled={busy} onClick={closeEditor}><X size={18} /></button>
        </div>
        <fieldset disabled={locked}>
          <div className="rule-form-grid">
            <label htmlFor="custom-rule-name">规则名称
              <input ref={nameInput} id="custom-rule-name" maxLength={60} required autoComplete="off" value={draft.name}
                onChange={event => changeDraft({ name: event.target.value })} placeholder="例如：内部项目代号" />
            </label>
            <label htmlFor="custom-rule-kind">匹配方式
              <select id="custom-rule-kind" aria-label="匹配方式" value={draft.kind} onChange={event => changeDraft({ kind: event.target.value as CustomRuleInput['kind'] })}>
                <option value="literal">固定文本</option><option value="regex">正则表达式</option>
              </select>
            </label>
          </div>
          <label className="rule-pattern-label" htmlFor="custom-rule-pattern">{draft.kind === 'literal' ? '匹配文本' : '正则表达式'}
            <textarea id="custom-rule-pattern" aria-label={draft.kind === 'literal' ? '匹配文本' : '正则表达式'} maxLength={512} required rows={3} spellCheck={false} value={draft.pattern}
              aria-describedby="rule-pattern-hint" onChange={event => changeDraft({ pattern: event.target.value })} />
          </label>
          <p id="rule-pattern-hint" className="rule-field-hint">{draft.kind === 'literal'
            ? '找到完全匹配的文本后，替换该片段或阻断请求。' : '填写表达式本身，无需包裹斜线。替换整个匹配片段；空匹配不受支持。'}</p>
          <div className="rule-form-options">
            <label className="rule-checkbox"><input type="checkbox" checked={draft.ignoreCase} onChange={event => changeDraft({ ignoreCase: event.target.checked })} />忽略大小写</label>
            <label className="rule-checkbox"><input type="checkbox" checked={draft.enabled} onChange={event => changeDraft({ enabled: event.target.checked })} />启用此规则</label>
            <label className="rule-action-field" htmlFor="custom-rule-action">命中后
              <select id="custom-rule-action" aria-label="命中后" value={draft.action} onChange={event => changeDraft({ action: event.target.value as RulePolicy['action'] })}>
                <option value="MASK">替换</option><option value="BLOCK">阻断</option>
              </select>
            </label>
          </div>
          <details className="rule-draft-test">
            <summary>测试这条规则</summary>
            <label htmlFor="custom-rule-test">待测试文本</label>
            <textarea id="custom-rule-test" rows={3} maxLength={12000} spellCheck={false} value={testText}
              onChange={event => { setTestText(event.target.value); setResult(undefined) }} />
            <div className="rule-test-actions"><span>仅在本机测试，不会保存或发送请求。</span>
              <button type="button" className="button" disabled={!testText.trim() || !draft.name.trim() || !draft.pattern.trim()} onClick={() => void testDraft()}>测试规则</button>
            </div>
            {result && <section className="rule-draft-result" aria-label="规则测试结果" aria-live="polite">
              <strong>{result.findings.length ? `命中 ${result.findings.length} 处 · ${result.action === 'BLOCK' ? '将阻断请求' : '将替换内容'}` : '未命中'}{!draft.enabled && ' · 此规则已关闭'}</strong>
              <pre data-testid="custom-rule-preview">{result.sanitized}</pre>
            </section>}
          </details>
          <div className="rule-form-footer"><p>替换会保留请求继续执行；阻断会停止整条请求。</p>
            <button className="button" type="button" onClick={closeEditor}>取消</button>
            <button className="button primary" type="submit" disabled={!draft.name.trim() || !draft.pattern.trim()}>{busy ? '正在保存…' : '保存规则'}</button>
          </div>
        </fieldset>
      </form>}
      <div className="rule-toolbar">
        <div className="filter-buttons" role="group" aria-label="规则来源">
          {(['all', 'builtin', 'custom'] as const).map(value => <button key={value} type="button"
            aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            {value === 'all' ? '全部' : value === 'builtin' ? '内置' : '自定义'}
            <span>{snapshot.rules.filter(rule => value === 'all' || rule.source === value).length}</span>
          </button>)}
        </div>
        <label className="rule-search"><Search size={16} /><input type="search" aria-label="搜索规则" placeholder="搜索名称或类型" value={search} onChange={event => setSearch(event.target.value)} /></label>
      </div>
      <div className="managed-rule-table">
        <table><thead><tr><th scope="col">规则</th><th scope="col">来源</th><th scope="col">命中后</th><th scope="col">状态</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{visible.map(rule => <tr key={rule.id} data-rule-id={rule.id} className={!rule.enabled ? 'rule-disabled' : ''}>
            <td><details className="managed-rule-description"><summary>{rule.name}</summary>
              <p>{rule.description}</p>{rule.matcher && <code>{rule.matcher.pattern}</code>}{rule.boundary && <p>{rule.boundary}</p>}
            </details><small>{CATEGORY_NAMES[rule.category]}{rule.matcher && ` · ${rule.matcher.kind === 'regex' ? '正则' : '固定文本'}`}</small></td>
            <td><span className="rule-source">{rule.source === 'builtin' ? '内置' : '自定义'}</span></td>
            <td><select aria-label={`${rule.name} 的处理动作`} value={rule.action} disabled={locked || !!editor} onChange={event => setPolicy(rule, { action: event.target.value as RulePolicy['action'] })}>
              <option value="MASK">替换</option><option value="BLOCK">阻断</option></select></td>
            <td><label className="rule-checkbox"><input type="checkbox" aria-label={`${rule.name} 的启用状态`} checked={rule.enabled} disabled={locked || !!editor}
              onChange={event => setPolicy(rule, { enabled: event.target.checked })} />{rule.enabled ? '已启用' : '已关闭'}</label></td>
            <td>{rule.source === 'custom' && (deleting === rule.id
              ? <div className="rule-delete-confirm"><span>删除此规则？</span><button type="button" className="text-button danger" disabled={locked || !!editor}
                  onClick={() => void save(() => window.privacy.deleteCustomRule(rule.id, snapshot.revision), () => setDeleting(undefined))}>确认删除</button>
                <button type="button" className="text-button" onClick={() => setDeleting(undefined)}>取消</button></div>
              : <div className="rule-row-actions"><button type="button" className="icon-button" aria-label={`编辑 ${rule.name}`} title="编辑规则" disabled={locked || !!editor} onClick={() => openEditor(rule)}><Pencil size={16} /></button>
                <button type="button" className="icon-button" aria-label={`删除 ${rule.name}`} title="删除规则" disabled={locked || !!editor} onClick={() => setDeleting(rule.id)}><Trash2 size={16} /></button></div>)}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <div className="rules-empty"><h2>{search ? '没有匹配的规则' : '还没有自定义规则'}</h2>
          <p>{search ? '尝试其他名称或类型。' : '内置规则已经启用。需要保护专属内容时，可添加固定文本或正则规则。'}</p>
          {!search && <button className="button" disabled={locked || !!editor} onClick={() => openEditor()}><Plus size={15} />添加第一条规则</button>}</div>}
      </div>
      <p className="rule-page-note">规则保存在本机，重启后保留。关闭规则后，该规则将不再检查新请求；命中其他规则时仍按其他规则处理。</p>
    </div>
  )
}
