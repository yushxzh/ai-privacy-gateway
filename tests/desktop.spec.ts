import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'

test('连续退出请求不会越过恢复步骤，原代理字段与恢复资料得到正确处理', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apg-quit-recovery-'))
  await mkdir(join(dir, '.workbuddy-ai'))
  await mkdir(join(dir, 'native-https'))
  const configPath = join(dir, '.workbuddy-ai/settings.json')
  const backupPath = join(dir, 'native-https/connection.json')
  await writeFile(configPath, JSON.stringify({ 'http.proxy': 'http://127.0.0.1:18788', 'http.proxySupport': 'override', theme: 'light' }))
  await writeFile(backupPath, JSON.stringify({ schema: 1, applied: true, original: { 'http.proxySupport': 'on' } }))
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined
    && !['ELECTRON_RUN_AS_NODE', 'APG_HTTPS_RUNTIME', 'APG_HTTPS_CA_DIR'].includes(key))) as Record<string, string>
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, APG_TEST_USER_DATA: dir, PRIVACY_GATEWAY_PORT: String(port) } })
  const childProcess = app.process()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '保护', exact: true })).toBeVisible()
    const exited = new Promise<void>(resolveExit => childProcess.once('exit', () => resolveExit()))
    await app.evaluate(({ app }) => { app.quit(); app.quit() }).catch(() => {})
    await exited
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ 'http.proxySupport': 'on', theme: 'light' })
    await expect(readFile(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    if (childProcess.exitCode === null) await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('桌面应用实际启动、生成过滤记录、隐藏原文、切换接入指引并释放端口', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'privacy-gateway-desktop-'))
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !['ELECTRON_RUN_AS_NODE', 'APG_HTTPS_RUNTIME', 'APG_HTTPS_CA_DIR'].includes(key)
    )
  ) as Record<string, string>
  const app = await electron.launch({
    args: [resolve('out/main/index.js')],
    env: { ...env, APG_TEST_USER_DATA: dir, PRIVACY_GATEWAY_PORT: String(port) }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: '保护' })).toBeVisible()
    await expect(page.getByRole('button', { name: '一键开启保护' })).toBeDisabled()
    await expect(page.getByText('此构建未包含本地代理运行时，请使用完整安装包。')).toBeVisible()
    await expect(page.getByRole('banner')).toContainText('网关运行中')
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    // 开发样例不再占用用户页面；仍通过真实桌面桥生成记录以验证记录交互。
    await page.evaluate(async () => {
      await window.privacy.demo('请联系 demo.user@example.com，演示手机号为 13800138000。')
      await window.privacy.demo('password=synthetic_example_123')
      await window.privacy.demo('普通文本')
    })
    await expect(page.locator('.record-row')).toHaveCount(3)
    await expect(page.getByRole('status')).toBeHidden()
    await mkdir('work/rule-settings-ui', { recursive: true })
    await page.screenshot({ path: 'work/rule-settings-ui/desktop.png', fullPage: true })
    await page.locator('.record-row').last().click()
    await expect(page.getByText('原始数据已隐藏')).toBeVisible()
    await expect(page.getByTestId('sanitized-data')).not.toContainText('demo.user@example.com')
    await page.getByRole('button', { name: '显示原文' }).click()
    await expect(page.getByTestId('original-data')).toContainText('demo.user@example.com')
    await page.getByRole('button', { name: '隐藏原文' }).click()
    await expect(page.getByText('原始数据已隐藏')).toBeVisible()
    await page.screenshot({ path: 'work/rule-settings-ui/inspection.png' })
    await page.getByRole('button', { name: '关闭详情' }).click()
    await page.getByRole('button', { name: '保护', exact: true }).click()
    await page.getByRole('button', { name: 'OpenAI / DeepSeek SDK', exact: false }).click()
    await page.getByRole('tab', { name: 'Claude Code' }).click()
    await expect(page.locator('.command-card pre')).toContainText('ANTHROPIC_BASE_URL')
    await page.getByRole('button', { name: 'Windows · PowerShell' }).click()
    await expect(page.locator('.command-card pre')).toContainText('$env:ANTHROPIC_CUSTOM_HEADERS')
    await expect(page.locator('.command-card pre')).not.toContainText('$env:ANTHROPIC_AUTH_TOKEN')
    await expect(page.getByRole('tab')).toHaveCount(12)
    await expect(page.getByText('WorkBuddy 原订阅可在「保护」页一键接入')).toBeVisible()
    await page.getByRole('button', { name: '启用原认证转发' }).click()
    await expect(page.getByText('已启用', { exact: true })).toBeVisible()
    for (const name of [
      'ZCode',
      'AutoClaw',
      'TraeWork',
      'CodeBuddy',
      'TraeCode',
      'OpenCode',
      'OpenClaw'
    ]) {
      await page.getByRole('tab', { name: new RegExp('^' + name + ' ') }).click()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: '原订阅接入待适配' })).toBeVisible()
      await expect(page.getByRole('button', { name: '复制命令' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '启用原认证转发' })).toHaveCount(0)
    }
    await page.getByRole('tab', { name: /^WorkBuddy / }).click()
    await expect(page.getByRole('button', { name: '启用 WorkBuddy 过滤' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '复制过滤地址' })).toHaveCount(0)
    const modelDir = join(dir, '.workbuddy-ai')
    await mkdir(modelDir)
    const modelPath = join(modelDir, 'models.json')
    const customModels = [{
      id: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions',
      apiKey: 'synthetic-workbuddy-test-key', supportsToolCall: true,
      supportsImages: true, supportsReasoning: true
    }, {
      id: 'qwen/custom-model', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'synthetic-qwen-key', supportsToolCall: true
    }, {
      id: 'local-model', url: 'http://127.0.0.1:11434/v1', apiKey: ''
    }, {
      id: 'builtin-example', type: 'builtin', url: 'https://builtin.example/chat/completions',
      apiKey: 'synthetic-builtin-key'
    }]
    await writeFile(modelPath, JSON.stringify(customModels))
    await page.getByRole('button', { name: '重新检查配置' }).click()
    await expect(page.locator('.workbuddy-model')).toHaveCount(3)
    const deepseek = page.getByRole('region', { name: 'deepseek-flash', exact: true })
    await deepseek.getByRole('button', { name: '启用过滤' }).click()
    await expect(deepseek.getByText('文本过滤已启用')).toBeVisible()
    await expect(deepseek.getByRole('button', { name: '复制本地地址' })).toBeVisible()
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('synthetic-workbuddy-test-key')
    await deepseek.getByRole('button', { name: '复制本地地址' }).click()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    const savedModels = JSON.parse(await readFile(modelPath, 'utf8'))
    expect(savedModels[0].url).toBe(copied)
    expect(savedModels[0].apiKey).toBe('synthetic-workbuddy-test-key')
    expect(savedModels[0].supportsToolCall).toBe(false)
    expect(savedModels[3]).toEqual(customModels[3])
    expect(copied).toMatch(new RegExp('^http://127\\.0\\.0\\.1:' + port + '/workbuddy/[a-f0-9]{64}/v1/chat/completions$'))
    const qwen = page.getByRole('region', { name: 'qwen/custom-model', exact: true })
    await qwen.getByRole('button', { name: '启用过滤' }).click()
    await expect(qwen.getByText('文本过滤已启用')).toBeVisible()
    await qwen.getByRole('button', { name: '恢复直连' }).click()
    await expect(qwen.getByText('尚未启用过滤')).toBeVisible()
    expect(JSON.parse(await readFile(modelPath, 'utf8'))[1]).toEqual(customModels[1])
    await page.getByRole('status').waitFor({ state: 'hidden' })
    await page.screenshot({ path: 'work/rule-settings-ui/workbuddy-custom.png' })
    await page.locator('.workbuddy-models').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'work/rule-settings-ui/workbuddy-models.png' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '停止网关', exact: true }).click()
    await page.getByRole('button', { name: '保护', exact: true }).click()
    await page.getByRole('button', { name: 'OpenAI / DeepSeek SDK', exact: false }).click()
    await page.getByRole('tab', { name: /^WorkBuddy / }).click()
    await expect(deepseek.getByRole('button', { name: '恢复直连' })).toBeEnabled()
    await expect(qwen.getByRole('button', { name: '启用过滤' })).toBeDisabled()
    await page.locator('.workbuddy-models').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'work/rule-settings-ui/workbuddy-stopped.png' })
    await deepseek.getByRole('button', { name: '恢复直连' }).click()
    await expect(deepseek.getByText('尚未启用过滤')).toBeVisible()
    expect(JSON.parse(await readFile(modelPath, 'utf8'))[0]).toEqual(customModels[0])
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '启动网关', exact: true }).click()
    await page.getByRole('button', { name: '保护', exact: true }).click()
    await page.getByRole('button', { name: 'OpenAI / DeepSeek SDK', exact: false }).click()
    await page.getByRole('tab', { name: /^WorkBuddy / }).click()
    await deepseek.getByRole('button', { name: '启用过滤' }).click()
    await expect(deepseek.getByText('文本过滤已启用')).toBeVisible()
    await rm(modelPath)
    // 外部删除配置后自动撤销接入，不依赖手动点击刷新。
    await expect(page.getByRole('button', { name: '启用 WorkBuddy 过滤' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '复制本地地址' })).toHaveCount(0)
    expect((await fetch(copied, { method: 'POST' })).status).toBe(409)
    await page.getByRole('tab', { name: 'Codex CLI' }).click()
    await expect(page.locator('.command-card pre')).toContainText('requires_openai_auth=true')
    await expect(page.locator('.command-card pre')).not.toContainText('.env_key=')
    await expect(page.getByRole('status')).toBeHidden()
    await page.screenshot({ path: 'work/rule-settings-ui/integrations.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 720))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('tab', { name: 'Codex CLI' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Claude Code' })).toBeFocused()
    await expect(page.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Home')
    await expect(page.getByRole('tab', { name: 'Codex CLI' })).toBeFocused()
    await page.screenshot({ path: 'work/rule-settings-ui/compact.png' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByLabel('上游 API Key', { exact: false })).toHaveCount(0)
    await expect(page.getByText('不需要额外填写凭据', { exact: true })).toBeVisible()
    await page.screenshot({ path: 'work/rule-settings-ui/settings.png' })
    await page.getByRole('button', { name: '规则', exact: true }).click()
    await expect(page.getByRole('heading', { name: '规则', exact: true })).toBeVisible()
    await expect(page.locator('[data-rule-id]')).toHaveCount(14)
    await expect(page.getByRole('button', { name: '验证本组全部样例' })).toHaveCount(0)
    await expect(page.getByText('语义分类')).toHaveCount(0)
    await expect(page.getByText('工作空间')).toHaveCount(0)
    await page.getByRole('button', { name: '记录', exact: false }).click()
    await expect(page.locator('.record-row')).toHaveCount(3)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '停止网关' }).click()
    await expect(page.getByRole('button', { name: '启动网关', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '启动网关', exact: true }).click()
    await expect(page.getByRole('button', { name: '停止网关' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
  const reuse = createServer()
  await new Promise<void>((resolve) => reuse.listen(port, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => reuse.close(() => resolve()))
})

test('规则界面可新增、编辑、选择动作、启停、删除，并在应用重启后保留设置', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apg-rule-desktop-'))
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined
    && !['ELECTRON_RUN_AS_NODE', 'APG_HTTPS_RUNTIME', 'APG_HTTPS_CA_DIR'].includes(key))) as Record<string, string>
  const launch = () => electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, APG_TEST_USER_DATA: dir, PRIVACY_GATEWAY_PORT: String(port) } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '规则', exact: true }).click()
    await expect(page.locator('[data-rule-id]')).toHaveCount(14)
    await expect(page.getByLabel('JWT / JWE 令牌 的处理动作')).toHaveValue('MASK')
    await page.getByLabel('JWT / JWE 令牌 的处理动作').selectOption('BLOCK')
    await expect.poll(async () => (await page.evaluate(() => window.privacy.ruleSettings())).rules.find(rule => rule.id === 'jwt')?.action).toBe('BLOCK')
    await page.getByRole('button', { name: '新增规则', exact: true }).click()
    await expect(page.getByLabel('规则名称', { exact: true })).toBeFocused()
    await page.getByLabel('规则名称', { exact: true }).fill('工单编号')
    await page.getByLabel('匹配方式', { exact: true }).selectOption('regex')
    await page.getByLabel('正则表达式', { exact: true }).fill('ISSUE-[0-9]{4}')
    await page.getByLabel('忽略大小写', { exact: true }).check()
    await page.getByText('测试这条规则', { exact: true }).click()
    await page.getByLabel('待测试文本', { exact: true }).fill('ISSUE-2026 / issue-1234 / 普通文字')
    await page.getByRole('button', { name: '测试规则', exact: true }).click()
    await expect(page.getByRole('region', { name: '规则测试结果' })).toContainText('命中 2 处')
    await expect(page.getByTestId('custom-rule-preview')).not.toContainText('ISSUE-2026')
    await expect(page.getByTestId('custom-rule-preview')).toContainText('普通文字')
    expect((await page.evaluate(() => window.privacy.snapshot())).records).toHaveLength(0)
    await mkdir('work/rule-settings-ui', { recursive: true })
    await page.screenshot({ path: 'work/rule-settings-ui/rule-editor-wide.png' })
    await page.getByRole('button', { name: '保存规则', exact: true }).click()
    await expect(page.getByRole('form', { name: '新增自定义规则' })).toHaveCount(0)
    await expect(page.locator('[data-rule-id]')).toHaveCount(15)
    const id = (await page.evaluate(() => window.privacy.ruleSettings())).rules.find(rule => rule.name === '工单编号')!.id
    await page.evaluate(() => window.privacy.demo('请处理 ISSUE-2026'))
    let record = (await page.evaluate(() => window.privacy.snapshot())).records[0]
    expect(record.action).toBe('MASK')
    expect(record.ruleMatches).toContainEqual({ id, name: '工单编号', source: 'custom', action: 'MASK' })
    expect((await page.evaluate(id => window.privacy.record(id, false), record.id))?.sanitized).not.toContain('ISSUE-2026')
    await page.getByLabel('工单编号 的处理动作').selectOption('BLOCK')
    await expect.poll(async () => (await page.evaluate(() => window.privacy.ruleSettings())).rules.find(rule => rule.id === id)?.action).toBe('BLOCK')
    await page.evaluate(() => window.privacy.demo('请处理 ISSUE-2026'))
    record = (await page.evaluate(() => window.privacy.snapshot())).records[0]
    expect(record.action).toBe('BLOCK'); expect(record.status).toBe('blocked')
    await page.getByLabel('工单编号 的启用状态').click()
    await expect(page.getByLabel('工单编号 的启用状态')).not.toBeChecked()
    await page.evaluate(() => window.privacy.demo('请处理 ISSUE-2026'))
    expect((await page.evaluate(() => window.privacy.snapshot())).records[0].action).toBe('ALLOW')
    await page.getByRole('button', { name: '编辑 工单编号', exact: true }).click()
    await page.getByLabel('规则名称', { exact: true }).fill('合同编号')
    await page.getByLabel('正则表达式', { exact: true }).fill('CONTRACT-[0-9]{4}')
    await page.getByLabel('命中后', { exact: true }).selectOption('MASK')
    await page.getByLabel('启用此规则', { exact: true }).check()
    await page.getByRole('button', { name: '保存规则', exact: true }).click()
    await expect(page.getByLabel('合同编号 的处理动作')).toHaveValue('MASK')
    await page.evaluate(() => window.privacy.demo('CONTRACT-2026'))
    expect((await page.evaluate(() => window.privacy.snapshot())).records[0].action).toBe('MASK')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 720))
    await page.getByLabel('搜索规则').fill('合同')
    await expect(page.locator('[data-rule-id]')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.locator('.managed-rule-table').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: 'work/rule-settings-ui/rules-compact.png' })
    await page.getByLabel('搜索规则').fill('')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 920))
    await page.screenshot({ path: 'work/rule-settings-ui/rules-wide.png' })
    await app.close()
    app = await launch(); page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '规则', exact: true }).click()
    await expect(page.getByLabel('JWT / JWE 令牌 的处理动作')).toHaveValue('BLOCK')
    await expect(page.getByLabel('合同编号 的处理动作')).toHaveValue('MASK')
    await expect(page.getByLabel('合同编号 的启用状态')).toBeChecked()
    await page.evaluate(() => window.privacy.demo('CONTRACT-2026'))
    expect((await page.evaluate(() => window.privacy.snapshot())).records[0].action).toBe('MASK')
    await page.getByRole('button', { name: '删除 合同编号', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.locator('[data-rule-id]')).toHaveCount(14)
    await page.evaluate(() => window.privacy.demo('CONTRACT-2026'))
    expect((await page.evaluate(() => window.privacy.snapshot())).records[0].action).toBe('ALLOW')
    await page.getByRole('button', { name: '新增规则', exact: true }).click()
    await page.getByLabel('规则名称', { exact: true }).fill('无效表达式')
    await page.getByLabel('匹配方式', { exact: true }).selectOption('regex')
    await page.getByLabel('正则表达式', { exact: true }).fill('(')
    await page.getByRole('button', { name: '保存规则', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('正则表达式格式无效')
    expect((await page.evaluate(() => window.privacy.ruleSettings())).rules).toHaveLength(14)
    await page.getByLabel('正则表达式', { exact: true }).fill('(a+)+$')
    await page.getByText('测试这条规则', { exact: true }).click()
    await page.getByLabel('待测试文本', { exact: true }).fill('a'.repeat(10000) + '!')
    await page.getByRole('button', { name: '测试规则', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('超时')
    await page.getByRole('button', { name: '关闭规则编辑' }).click()
    await expect(page.getByRole('button', { name: '新增规则', exact: true })).toBeFocused()
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})
