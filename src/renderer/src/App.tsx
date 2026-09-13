import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Cloud,
  Code2,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Pause,
  Play,
  Plug,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import brandIcon from '../../../resources/icon.svg'
import { CLIENTS } from '../../shared/integrations'
import { CATEGORY_NAMES, RULES } from '../../shared/rules'
import { RuleWorkbench } from './RuleWorkbench'
import { ProtectionPanel } from './ProtectionPanel'
import type {
  Action,
  ClientKind,
  IntegrationGuide,
  ProviderKind,
  RecordDetail,
  RecordSummary,
  Settings,
  ShellKind,
  Snapshot,
  WorkBuddyConfiguration
} from '../../shared/types'

const api = window.privacy
const providerNames: Record<ProviderKind, string> = {
  demo: '离线演示',
  client: '沿用客户端认证',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  compatible: '兼容服务 / 本地模型'
}
const categoryNames = CATEGORY_NAMES
const actionNames: Record<Action, string> = { ALLOW: '放行', MASK: '替换', BLOCK: '阻断', ROUTE: '路由' }
const statusNames = { pending: '处理中', completed: '已完成', blocked: '已阻断', failed: '请求失败' }
const availableClients = CLIENTS.filter(item => ['sdk', 'deepseek', 'workbuddy', 'codex', 'claude'].includes(item.id))
type Page = 'overview' | 'records' | 'integrations' | 'settings' | 'rules'

function Badge({ action }: { action: Action }) {
  return (
    <span className={`badge ${action.toLowerCase()}`}>
      <span />
      {actionNames[action]}
    </span>
  )
}

function RecordBadge({ record }: { record: RecordSummary }) {
  return record.inspectionIssue
    ? <span className="badge block">{record.inspectionIssue === 'outside-scope' ? '未检查' : '检查失败'}</span>
    : <Badge action={record.action} />
}
function Button({
  children,
  onClick,
  className = '',
  disabled = false,
  title,
  type = 'button'
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} className={`button ${className}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [page, setPage] = useState<Page>('overview')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const [reveal, setReveal] = useState(false)
  const refresh = async () => setSnapshot(await api.snapshot())

  useEffect(() => {
    if (!api) {
      setError('请通过桌面应用启动此界面。')
      return
    }
    void refresh().catch(() => setError('无法连接桌面服务。'))
    return api.onChange(() => {
      void refresh().catch(() => setError('无法更新网关状态。'))
    })
  }, [])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    let current = true
    setDetail(null)
    if (selected && snapshot && !snapshot.records.some(record => record.id === selected)) {
      setSelected(undefined)
      setReveal(false)
      return
    }
    if (selected)
      void api
        .record(selected, reveal)
        .then((record) => {
          if (current) setDetail(record)
        })
        .catch(() => setError('无法读取记录。'))
    return () => {
      current = false
    }
  }, [selected, reveal, snapshot?.records])
  useEffect(() => {
    if (!selected) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const background = document.querySelectorAll<HTMLElement>('.sidebar, .main-shell')
    background.forEach((element) => {
      element.inert = true
    })
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea, input, select, [tabindex="0"]'
        ) ?? []
      )
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(undefined)
        setReveal(false)
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      background.forEach((element) => {
        element.inert = false
      })
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [selected])

  async function run(operation: () => Promise<unknown>, success?: string) {
    setBusy(true)
    setError('')
    try {
      await operation()
      await refresh()
      if (success) setToast(success)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '操作未完成。'
      )
    } finally {
      setBusy(false)
    }
  }
  function selectRecord(record: RecordSummary) {
    setReveal(false)
    setSelected(record.id)
  }
  const navigation: { id: Page; title: string; icon: ReactNode }[] = [
    { id: 'overview', title: '保护', icon: <LayoutDashboard size={18} /> },
    { id: 'records', title: '记录', icon: <Activity size={18} /> },
    { id: 'rules', title: '规则', icon: <ShieldCheck size={18} /> },
    { id: 'settings', title: '设置', icon: <SlidersHorizontal size={18} /> }
  ]

  if (!snapshot)
    return (
      <main className="loading">
        <Shield size={36} />
        <h2>{error || '正在启动本地网关…'}</h2>
      </main>
    )
  return (
    <div className={`app-shell platform-${api.platform}`}>
      <aside className="sidebar">
        {api.platform === 'darwin' && <div className="window-drag-region" aria-hidden="true" />}
        <div className="brand">
          <img className="brand-mark" src={brandIcon} alt="" />
          <div>
            <strong>Privacy Gateway</strong>
            <span>AI 的本地隐私层</span>
          </div>
        </div>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
              className={page === item.id ? 'nav-item active' : 'nav-item'}
            >
              {item.icon}
              {item.title}
              {item.id === 'records' && snapshot.records.length > 0 && <b>{snapshot.records.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <LockKeyhole size={17} />
            <div>
              <strong>请求记录仅保存在内存</strong>
              <span>规则配置保存在本机</span>
            </div>
          </div>
          <div className="build-label">
            <span>本地预览版</span>
            <code>v{api.version}</code>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{page === 'integrations' ? '接入应用' : navigation.find((item) => item.id === page)?.title}</span>
          </div>
          <div className="topbar-status">
            <span className={snapshot.running || snapshot.nativeHttps ? 'tiny-dot' : 'tiny-dot off'} />
            {snapshot.running || snapshot.nativeHttps ? '网关运行中' : '网关已停止'}
          </div>
        </header>
        <main className="page">
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="关闭错误" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {snapshot.error && (
            <div className="notice error" role="alert">
              {snapshot.error}
            </div>
          )}
          {page === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <h1>保护</h1>
                  <p>在请求发送前检查敏感信息，保留每一次处理的依据。</p>
                </div>
                <Button className="primary" onClick={() => setPage('rules')}><ShieldCheck size={16} />管理规则</Button>
              </div>
              <ProtectionPanel value={snapshot.protection} busy={busy} change={enabled => void run(() => api.setProtection(enabled))} />
              <section className="gateway-panel">
                <div className="gateway-summary">
                  <h2>{snapshot.nativeHttps ? 'WorkBuddy 原生保护' : '本地 API 网关'}</h2>
                  <p>{snapshot.nativeHttps ? '沿用原登录和模型。是否经过检查，以实际请求记录为准。' : '接入应用后，按当前规则替换敏感内容或阻断请求。'}</p>
                  <div className="endpoint-line">
                    <code>{snapshot.nativeHttps ? 'http://127.0.0.1:18788' : snapshot.baseUrl}</code>
                    <button
                      title="复制本地地址"
                      aria-label="复制本地地址"
                      onClick={() => void run(() => api.copy(snapshot.nativeHttps ? 'http://127.0.0.1:18788' : snapshot.baseUrl), '本地地址已复制')}
                    >
                      <Clipboard size={15} />
                    </button>
                  </div>
                  <div className="gateway-meta">
                    <span>
                      <LockKeyhole size={13} />
                      {snapshot.nativeHttps ? '沿用 WorkBuddy 认证' : '独立本地通行验证'}
                    </span>
                    <span>
                      <Database size={13} />
                      仅内存记录
                    </span>
                  </div>
                </div>
                <div className="route-visual">
                  <div className="route-head">
                    请求处理路径 <span>检测发生在本机</span>
                  </div>
                  <div className="route-stations">
                    <div>
                      <span className="station">
                        <Terminal size={20} />
                      </span>
                      <strong>应用</strong>
                      <small>原始请求</small>
                    </div>
                    <div className="route-connector" />
                    <div>
                      <span className="station protected">
                        <ShieldCheck size={22} />
                      </span>
                      <strong>隐私网关</strong>
                      <small>检测 · 替换 · 阻断</small>
                    </div>
                    <div className="route-connector dashed" />
                    <div>
                      <span className="station">
                        <Cloud size={21} />
                      </span>
                      <strong>{snapshot.nativeHttps ? 'WorkBuddy 官方服务' : snapshot.workbuddyEnabled ? '自定义 API · WorkBuddy' : providerNames[snapshot.settings.provider]}</strong>
                      <small>
                        {!snapshot.nativeHttps && !snapshot.workbuddyEnabled && snapshot.settings.provider === 'demo' ? '不会连接外网' : '通过检查后转发'}
                      </small>
                    </div>
                  </div>
                  <div className="route-footer">
                    <Shield size={13} />
                    原文与替换映射不发送给审计服务
                  </div>
                </div>
              </section>
              <div className="stat-grid">
                <Stat
                  label="本次启动的请求"
                  value={snapshot.counters.total}
                  icon={<Activity size={17} />}
                  hint={`其中 ${snapshot.counters.unchecked} 条未完成内容检查`}
                />
                <Stat
                  label="敏感内容已替换"
                  value={snapshot.counters.masked}
                  icon={<Fingerprint size={17} />}
                  hint="按当前规则替换"
                  color="green"
                />
                <Stat
                  label="按规则阻断"
                  value={snapshot.counters.blocked}
                  icon={<Shield size={17} />}
                  hint="请求未发送至上游"
                  color="orange"
                />
                <Stat
                  label="规则检查后放行"
                  value={snapshot.counters.allowed}
                  icon={<CheckCheck size={17} />}
                  hint="当前规则未命中"
                />
              </div>
              <div className="overview-bottom">
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <h3>
                      最近模型请求 <span>{snapshot.records.filter(record => record.inspectionIssue !== 'outside-scope').length}</span>
                    </h3>
                    <button className="text-button" onClick={() => setPage('records')}>
                      查看全部 <ArrowRight size={14} />
                    </button>
                  </div>
                  <RecordList records={snapshot.records.filter(record => record.inspectionIssue !== 'outside-scope').slice(0, 5)} onSelect={selectRecord} compact />
                </section>
                <section className="panel start-panel">
                  <div className="panel-heading">
                    <h3>连接一个应用</h3>
                    <Plug size={17} />
                  </div>
                  <p>WorkBuddy 原登录在上方接入；自备 API 使用下方配置。</p>
                  {[
                    { title: 'OpenAI / DeepSeek SDK', tag: '文本 API' },
                    { title: '自定义 API 与实验接入', tag: 'WorkBuddy / Codex / Claude Code' }
                  ].map((item) => (
                    <button key={item.title} className="connect-row" onClick={() => setPage('integrations')}>
                      <Code2 size={18} />
                      <span>
                        {item.title}
                        <small>{item.tag}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  <div className="subtle-note">
                    <CircleHelp size={14} />
                    完整 Agent 工具协议仍待适配。
                  </div>
                </section>
              </div>
              <div className="page-footnote">
                <ShieldCheck size={14} />
                规则检测可能存在漏检或误报。仅保护实际经过本地网关的请求。
              </div>
            </>
          )}
          {page === 'records' && (
            <RecordsPage
              snapshot={snapshot}
              onSelect={selectRecord}
              onClear={() =>
                void run(async () => {
                  await api.clearRecords()
                  setSelected(undefined)
                  setReveal(false)
                }, '本地记录已清空')
              }
            />
          )}
          {page === 'integrations' && <IntegrationsPage snapshot={snapshot} run={run} />}
          {page === 'rules' && <RuleWorkbench />}
          {page === 'settings' && <SettingsPage snapshot={snapshot} busy={busy} run={run} />}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {selected && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setSelected(undefined)
            setReveal(false)
          }}
        >
          <section
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="请求详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>请求处理详情</h2>
              </div>
              <button
                aria-label="关闭详情"
                onClick={() => {
                  setSelected(undefined)
                  setReveal(false)
                }}
              >
                <X size={19} />
              </button>
            </div>
            {detail ? (
              <>
                <div className="detail-meta">
                  <RecordBadge record={detail} />
                  <span>{new Date(detail.time).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span>{detail.durationMs} ms</span>
                  <span>{detail.inspectionIssue === 'outside-scope' ? '范围外请求' : statusNames[detail.status]}</span>
                </div>
                <div className="detail-tags">
                  {detail.categories.map((category) => (
                    <span key={category}>{categoryNames[category]}</span>
                  ))}
                  <code>{detail.endpoint}</code>
                </div>
                <p className="detail-note">{detail.note}</p>
                {!!detail.ruleMatches?.length ? <p className="detail-note">命中规则：{detail.ruleMatches.map(rule => `${rule.name}（${rule.source === 'builtin' ? '内置' : '自定义'} · ${actionNames[rule.action]}）`).join('、')} · 配置版本 {detail.rulesRevision}</p>
                  : !!detail.ruleIds?.length && <p className="detail-note">命中规则：{detail.ruleIds.map(id => RULES.find(rule => rule.id === id)?.name ?? id).join('、')}</p>}
                {detail.action === 'BLOCK' && !detail.inspectionIssue && <button className="text-button" onClick={() => { setSelected(undefined); setReveal(false); setPage('rules') }}>修改规则的处理动作</button>}
                {detail.transport === 'https-proxy' && !detail.inspectionIssue && <p className="detail-note">HTTPS 代理 · 原官方服务：{detail.upstreamHost} · 原客户端认证。下方优先展示发生替换的内容字段。</p>}
                {detail.outbound && <div className="detail-id">
                  <span>实际请求正文：{detail.outbound.bytes} 字节 · 原认证{detail.outbound.authenticationUnchanged ? '保持不变' : '校验失败'} · 命中原文{detail.outbound.originalsAbsent ? '已移除' : '仍存在'}</span>
                  <code>SHA-256 {detail.outbound.sha256}</code>
                </div>}
                {detail.inspectionIssue ? <p className="subtle-note">未保存该请求的正文、认证或查询参数。此记录不计为规则检查后放行。</p> : <div className="comparison">
                  <div>
                    <div className="comparison-heading">
                      <strong>原始数据</strong>
                      <button className="text-button" onClick={() => setReveal(!reveal)}>
                        {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                        {reveal ? '隐藏原文' : '显示原文'}
                      </button>
                    </div>
                    {reveal ? (
                      <pre data-testid="original-data">{detail.original}</pre>
                    ) : (
                      <div className="hidden-original">
                        <LockKeyhole size={24} />
                        <strong>原始数据已隐藏</strong>
                        <span>仅在本机按需查看</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="comparison-heading">
                      <strong>{detail.action === 'BLOCK' ? '替换预览 · 未外发' : detail.status !== 'completed' && !detail.outbound ? '替换预览 · 尚未确认外发' : detail.transport === 'https-proxy' ? '外发正文中的内容字段' : '发送给上游的数据'}</strong>
                      <span className="mini-label">已处理</span>
                    </div>
                    <pre data-testid="sanitized-data">{detail.sanitized}</pre>
                  </div>
                </div>}
                {detail.truncated && <p className="subtle-note">长记录保留开头与结尾，每侧最多 24,000 个字符；中间内容省略，不影响完整请求的检测。</p>}
                <div className="detail-id">
                  请求 ID <code>{detail.id}</code>
                </div>
              </>
            ) : (
              <p>正在读取记录…</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  icon,
  hint,
  color = ''
}: {
  label: string
  value: number
  icon: ReactNode
  hint: string
  color?: string
}) {
  return (
    <section className={`stat ${color}`}>
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </section>
  )
}

function RecordList({
  records,
  onSelect,
  compact = false
}: {
  records: RecordSummary[]
  onSelect: (record: RecordSummary) => void
  compact?: boolean
}) {
  if (!records.length)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Activity size={25} />
        </div>
        <strong>等待第一条请求</strong>
        <p>
          在已接入的应用中发送请求，再回到这里查看检查结果。
          <br />
          每次检查都会在这里留下记录。
        </p>
      </div>
    )
  return (
    <div className={`record-table ${compact ? 'compact' : ''}`}>
      <div className="record-table-head">
        <span>请求 / 模型</span>
        <span>识别类型</span>
        <span>处理动作</span>
        <span>时间</span>
        <span />
      </div>
      {records.map((record) => (
        <button className="record-row" key={record.id} onClick={() => onSelect(record)}>
          <span className="record-name">
            <span className={`record-icon ${record.action.toLowerCase()}`}>
              {record.action === 'BLOCK' ? <Shield size={16} /> : <Activity size={16} />}
            </span>
            <span>
              <strong>{record.model}</strong>
              <small>
                {record.source === 'demo' ? '本地演示' : record.upstreamHost || providerNames[record.provider]} ·{' '}
                {record.status === 'failed' ? '请求失败' : record.endpoint.split('/').pop()}
              </small>
            </span>
          </span>
          <span className="record-category">
            {record.categories.length
              ? record.categories.map((category) => categoryNames[category]).join('、')
              : record.inspectionIssue ? '未完成检查' : '未命中规则'}
          </span>
          <span>
            <RecordBadge record={record} />
          </span>
          <span className="record-time">
            {new Date(record.time).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
          <ChevronRight size={14} />
        </button>
      ))}
    </div>
  )
}

function RecordsPage({
  snapshot,
  onSelect,
  onClear
}: {
  snapshot: Snapshot
  onSelect: (record: RecordSummary) => void
  onClear: () => void
}) {
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const records = snapshot.records.filter(
    (record) =>
      (filter === 'ALL' || (filter === 'UNCHECKED' ? !!record.inspectionIssue : !record.inspectionIssue && record.action === filter)) &&
      `${record.model} ${record.endpoint} ${record.categories.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase())
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>请求记录</h1>
          <p>最多保留 100 条；其中范围外流量仅保留最近 20 条。</p>
        </div>
        <Button onClick={onClear} disabled={!snapshot.records.length}>
          <Trash2 size={16} />
          清空记录
        </Button>
      </div>
      <section className="panel">
        <div className="records-toolbar">
          <div className="segmented">
            {[
              ['ALL', '全部'],
              ['MASK', '替换'],
              ['BLOCK', '阻断'],
              ['ALLOW', '放行'],
              ['UNCHECKED', '未检查']
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'selected' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search size={15} />
            <input
              aria-label="搜索模型或类型"
              placeholder="搜索模型或类型"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <RecordList records={records} onSelect={onSelect} />
      </section>
      <div className="page-footnote">
        <LockKeyhole size={14} />
        原文默认隐藏，关闭应用后清空。清空记录不会取消正在处理的请求。
      </div>
    </>
  )
}

type Run = (operation: () => Promise<unknown>, success?: string) => Promise<void>

function WorkBuddyConnection({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const [config, setConfig] = useState<WorkBuddyConfiguration>()
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState('')
  const refresh = async () => {
    setConfig(await api.workbuddyConfiguration())
    setReadError('')
  }
  useEffect(() => {
    let current = true
    const update = () => {
      void api.workbuddyConfiguration().then(value => {
        if (current) { setConfig(value); setReadError('') }
      }).catch(() => {
        if (current) setReadError('无法检查 WorkBuddy 配置，请重新检查。')
      })
    }
    update()
    const unsubscribe = api.onChange(update)
    return () => { current = false; unsubscribe() }
  }, [snapshot.workbuddyEnabled, snapshot.settings.port])
  return (
    <div className="workbuddy-connection">
      <div className="workbuddy-check">
        <div>
          <strong>已保存的自定义 API</strong>
          <p>Key 保留在 WorkBuddy。逐个启用文本过滤，内置模型保持原连接。</p>
        </div>
        <button className="text-button" disabled={loading} onClick={() => void run(refresh)}>
          <RefreshCw size={14} />重新检查配置
        </button>
      </div>
      {(readError || config?.error) && <p role="alert" className="inline-error">{readError || config?.error}</p>}
      {!config ? <p className="workbuddy-help">正在读取自定义模型…</p> : !config.models.length ? (
        <div className="workbuddy-empty">
          <Plug size={24} />
          <strong>先在 WorkBuddy 保存自定义模型</strong>
          <p>填写模型来源、模型名称和 Key 后，返回这里重新检查。</p>
          <Button disabled>启用 WorkBuddy 过滤</Button>
        </div>
      ) : <div className="workbuddy-models">
        {config.models.map(model => (
          <section className="workbuddy-model" key={model.id} aria-label={model.name}>
            <div className="workbuddy-model-heading">
              <div><strong>{model.name}</strong><span>{model.connected ? '文本过滤已启用' : '尚未启用过滤'}</span></div>
              <Button disabled={loading || !!model.issue || (!model.connected && !snapshot.running)}
                className={model.connected ? '' : 'primary'}
                onClick={() => void run(async () => {
                  setLoading(true)
                  try { setConfig(await api.setWorkbuddyModel(model.id, !model.connected)) }
                  finally { setLoading(false) }
                }, model.connected ? '已恢复原服务地址，WorkBuddy 必要时需重启' : '已更新模型接口，WorkBuddy 必要时需重启')}>
                {model.connected ? '恢复直连' : '启用过滤'}
              </Button>
            </div>
            {model.sourceUrl && <code className="workbuddy-source">{model.sourceUrl}</code>}
            {model.issue && <p className="inline-error">{model.issue}</p>}
            {model.gatewayUrl && <div className="workbuddy-endpoint">
              <code>{model.gatewayUrl.replace(/\/[a-f0-9]{64}\//, '/本地连接/')}</code>
              <button className="text-button" onClick={() => void run(() => api.copy(model.gatewayUrl!), '本地连接地址已复制')}>
                <Clipboard size={14} />复制本地地址
              </button>
            </div>}
          </section>
        ))}
      </div>}
      <p className="workbuddy-help">启用后更新所选模型接口，并关闭工具、图片和思考能力；仅处理文本。新任务选择对应自定义模型，未加载新配置时重启 WorkBuddy。接入资料保存在本机，App 重启后恢复已接入模型。</p>
    </div>
  )
}

function IntegrationsPage({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const [client, setClient] = useState<ClientKind>('sdk')
  const [shell, setShell] = useState<ShellKind>('bash')
  const [guide, setGuide] = useState<IntegrationGuide>()
  useEffect(() => {
    let current = true
    setGuide(undefined)
    void api.guide(client, shell).then((value) => {
      if (current) setGuide(value)
    })
    return () => {
      current = false
    }
  }, [client, shell, snapshot.settings.port, snapshot.settings.provider, snapshot.settings.baseUrl, snapshot.settings.model])
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>接入应用</h1>
          <p>配置文本 API；实验入口的支持范围单独标明。</p>
        </div>
        <span className="endpoint-chip">
          <span className={snapshot.running ? 'tiny-dot' : 'tiny-dot off'} />
          <code>{snapshot.baseUrl}</code>
        </span>
      </div>
      <div className="subscription-readiness">
        <Shield size={18} />
        <div>
          <strong>WorkBuddy 原登录可在「保护」页一键接入</strong>
          <p>这里保留自定义 API 和其他客户端的接入方式；各客户端的验证进度分别列出。</p>
        </div>
      </div>
      <div className="integration-tabs" role="tablist" aria-label="客户端">
        {availableClients.map((item, index) => (
          <button
            role="tab"
            id={`client-tab-${item.id}`}
            aria-controls="client-guide"
            aria-selected={client === item.id}
            tabIndex={client === item.id ? 0 : -1}
            className={client === item.id ? 'selected' : ''}
            key={item.id}
            onClick={() => setClient(item.id)}
            onKeyDown={(event) => {
              const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!offset && event.key !== 'Home' && event.key !== 'End') return
              event.preventDefault()
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? availableClients.length - 1
                    : (index + offset + availableClients.length) % availableClients.length
              setClient(availableClients[next].id)
              document.getElementById(`client-tab-${availableClients[next].id}`)?.focus()
            }}
          >
            {['codex', 'claude', 'opencode', 'openclaw'].includes(item.id) ? (
              <Terminal size={18} />
            ) : (
              <Plug size={18} />
            )}
            <span>
              {item.name}
              <small>{item.status}</small>
            </span>
          </button>
        ))}
      </div>
      {guide && (
        <section
          className="panel integration-panel"
          role="tabpanel"
          id="client-guide"
          aria-labelledby={`client-tab-${client}`}
        >
          <div className="integration-heading">
            <div>
              <h2>{guide.title}</h2>
              <span className="status-pill">{guide.status}</span>
            </div>
            <button className="text-button" onClick={() => void run(() => api.openDocs(client))}>
              官方文档 <ArrowRight size={14} />
            </button>
          </div>
          <div className="integration-content">
            {client === 'workbuddy' && <WorkBuddyConnection snapshot={snapshot} run={run} />}
            {(client === 'codex' || client === 'claude') && (
              <div className="auth-connection">
                <div className="auth-icon">
                  <KeyRound size={22} />
                </div>
                <div>
                  <strong>原认证转发实验</strong>
                  <p>登录、API Key 和续期继续由客户端管理，无需在此输入 Token。</p>
                </div>
                {snapshot.settings.provider === 'client' ? (
                  <span className="auth-active">
                    <Check size={15} />
                    已启用
                  </span>
                ) : (
                  <Button
                    className="primary"
                    onClick={() =>
                      void run(
                        () =>
                          api.saveSettings({
                            ...snapshot.settings,
                            provider: 'client',
                            baseUrl: '',
                            model: 'from-client',
                            apiKey: ''
                          }),
                        '原认证转发已启用'
                      )
                    }
                  >
                    启用原认证转发
                  </Button>
                )}
              </div>
            )}
            <ol className="steps">
              {guide.steps.map((step, i) => (
                <li key={step}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
            {guide.code ? (
              <div className="command-card">
                <div className="command-toolbar">
                  <div className="shell-tabs">
                    <button className={shell === 'bash' ? 'active' : ''} onClick={() => setShell('bash')}>
                      macOS · Bash / Zsh
                    </button>
                    <button
                      className={shell === 'powershell' ? 'active' : ''}
                      onClick={() => setShell('powershell')}
                    >
                      Windows · PowerShell
                    </button>
                  </div>
                  <button
                    className="copy-command"
                    onClick={() => void run(() => api.copy(guide.code), '接入命令已复制，无需手动填写凭据')}
                  >
                    <Clipboard size={14} />
                    复制命令
                  </button>
                </div>
                <pre>{guide.code.replace(/apg_[a-f0-9]{64}/g, '<本次本地令牌>')}</pre>
                <div className="command-note">
                  <KeyRound size={13} />
                  {client === 'codex' || client === 'claude'
                    ? '保留客户端原认证，本地通行凭据已自动填入。'
                    : '本地访问凭据已自动填入，不包含上游 API Key。'}
                </div>
              </div>
            ) : client !== 'workbuddy' ? (
              <div className="unavailable">
                <Plug size={24} />
                <h3>原订阅接入待适配</h3>
                <p>完整请求接受本地检查后再提供配置。连接成功不代表隐私过滤已生效。</p>
              </div>
            ) : null}
          </div>
          <div className="notice info">
            <CircleHelp size={17} />
            <span>{guide.warning}</span>
          </div>
        </section>
      )}
      <div className="page-footnote">
        <Radio size={14} />
        只有实际请求到达本地端口并产生记录，才说明该调用经过网关。
      </div>
    </>
  )
}

function SettingsPage({ snapshot, busy, run }: { snapshot: Snapshot; busy: boolean; run: Run }) {
  const running = snapshot.running || snapshot.nativeHttps
  const [form, setForm] = useState<Settings>({ ...snapshot.settings })
  const [key, setKey] = useState('')
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const canRemove = snapshot.protection?.managed || snapshot.protection?.certificatePresent
  const changingProtection = busy || ['starting', 'stopping', 'removing'].includes(snapshot.protection?.state ?? '')
  function changeProvider(provider: ProviderKind) {
    const presets = {
      demo: { baseUrl: '', model: 'privacy-demo' },
      client: { baseUrl: '', model: 'from-client' },
      openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
      anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '' },
      deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: '' },
      compatible: { baseUrl: 'http://127.0.0.1:11434/v1', model: '' }
    }
    setForm({ ...form, provider, ...presets[provider] })
    setKey('')
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>网关设置</h1>
          <p>配置本地 API 网关。WorkBuddy 原登录的开启与恢复位于「保护」页。</p>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            void run(() => api.setRunning(!running), running ? '网关已停止' : '网关已启动')
          }
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
          {running ? '停止网关' : '启动网关'}
        </Button>
      </div>
      <div className="settings-layout">
        <form
          className="panel settings-form"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              await api.saveSettings({ ...form, apiKey: key })
              setKey('')
            }, '设置已应用，网关已重新启动')
          }}
        >
          <div className="panel-heading">
            <h3>连接方式</h3>
            <Settings2 size={17} />
          </div>
          <div className="form-fields">
            <div className="form-row">
              <label htmlFor="port">
                本地端口<span>只监听 127.0.0.1 回环地址</span>
              </label>
              <input
                id="port"
                type="number"
                min={1024}
                max={65535}
                required
                value={form.port}
                onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
              />
            </div>
            <div className="form-row">
              <label htmlFor="provider">
                转发模式<span>Codex / Claude Code 原认证转发实验</span>
              </label>
              <select
                id="provider"
                value={form.provider}
                onChange={(event) => changeProvider(event.target.value as ProviderKind)}
              >
                {Object.entries(providerNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {form.provider === 'client' && (
              <div className="auth-explainer">
                <KeyRound size={20} />
                <div>
                  <strong>不需要额外填写凭据</strong>
                  <p>
                    仅有文本子集和模拟认证验证。真实订阅、账号政策及完整编码任务仍需验证；模型由客户端选择。
                  </p>
                </div>
              </div>
            )}
            {!['demo', 'client'].includes(form.provider) && (
              <>
                <div className="form-stacked">
                  <label htmlFor="base-url">上游 API 地址</label>
                  <input
                    id="base-url"
                    type="url"
                    required
                    value={form.baseUrl}
                    onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                  />
                  <small>远端使用 HTTPS，本地模型可使用 HTTP。</small>
                </div>
                <div className="form-stacked">
                  <label htmlFor="api-key">
                    上游 API Key {snapshot.hasApiKey && <span className="mini-label">当前会话已配置</span>}
                  </label>
                  <input
                    id="api-key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="仅保存在本机内存"
                  />
                  <small>每次保存需重新填写；留空会清除当前 Key。本地模型可留空。</small>
                </div>
              </>
            )}
            {form.provider !== 'client' && (
              <div className="form-stacked">
                <label htmlFor="model">模型名称</label>
                <input
                  id="model"
                  required
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                  placeholder="填写该服务实际可用的模型 ID"
                />
                <small>接入指引与模型列表使用此名称。</small>
              </div>
            )}
          </div>
          <div className="form-footer">
            <span>
              <RefreshCw size={13} />
              保存会重启网关并中断当前请求
            </span>
            <Button type="submit" className="primary" disabled={busy}>
              应用设置
            </Button>
          </div>
        </form>
        <div className="settings-aside">
          <section className="panel privacy-settings certificate-settings" aria-label="接入与证书管理">
            <h3>接入与证书</h3>
            <p>卸载前移除原生接入，恢复 WorkBuddy 原代理，并撤销本产品证书信任和私钥。规则配置保留。</p>
            {confirmRemoval ? <>
              <p role="alert">WorkBuddy 会正常退出并重新打开，请先保存任务。再次开启保护时需要重新授权。</p>
              <Button disabled={changingProtection} onClick={() => void run(async () => {
                await api.removeProtection()
                setConfirmRemoval(false)
              }, '原生接入与证书已移除')}>确认移除</Button>
              <Button disabled={changingProtection} onClick={() => setConfirmRemoval(false)}>取消</Button>
            </> : <Button disabled={changingProtection || !canRemove}
              title={canRemove ? undefined : '没有需移除的原生接入或证书'} onClick={() => setConfirmRemoval(true)}>
              <Trash2 size={15} />移除接入和证书
            </Button>}
            {!canRemove && <small>没有需移除的原生接入或证书。</small>}
          </section>
          <section className="panel privacy-settings">
            <ShieldCheck size={24} />
            <h3>本地优先的默认设置</h3>
            <div>
              <span>原始请求记录</span>
              <strong>仅内存</strong>
            </div>
            <div>
              <span>映射作用范围</span>
              <strong>单次请求</strong>
            </div>
            <div>
              <span>App 云端遥测</span>
              <strong>无</strong>
            </div>
            <div>
              <span>原生与流式回复</span>
              <strong>保留代号</strong>
            </div>
            <Button onClick={() => void run(() => api.openHelp())}><CircleHelp size={15} />使用与恢复指南</Button>
          </section>
          <div className="notice info">
            <CircleHelp size={17} />
            <span>配置后先用非敏感文本验证上游。检测规则尚未覆盖全部个人信息和业务机密。</span>
          </div>
        </div>
      </div>
    </>
  )
}
