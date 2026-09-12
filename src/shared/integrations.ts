import type { ClientKind, IntegrationGuide, Settings, ShellKind } from './types'

export const SOURCE_URLS: Record<ClientKind, string> = {
  sdk: 'https://platform.openai.com/docs/api-reference/chat',
  codex: 'https://developers.openai.com/codex/config-advanced/',
  claude: 'https://code.claude.com/docs/en/llm-gateway-protocol',
  deepseek: 'https://api-docs.deepseek.com/',
  zcode: 'https://zcode.z.ai/cn/docs/configuration',
  autoclaw: 'https://autoclaw.z.ai/',
  workbuddy: 'https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model',
  traework: 'https://docs.trae.cn/work_models',
  codebuddy: 'https://www.codebuddy.cn/docs/ide/Features/models',
  traecode: 'https://docs.trae.cn/ide_models',
  opencode: 'https://opencode.ai/docs/providers',
  openclaw: 'https://docs.openclaw.ai/providers/openai'
}

export const CLIENTS: { id: ClientKind; name: string; status: string }[] = [
  { id: 'codex', name: 'Codex CLI', status: '实验转发' },
  { id: 'claude', name: 'Claude Code', status: '实验转发' },
  { id: 'zcode', name: 'ZCode', status: '原订阅待核验' },
  { id: 'autoclaw', name: 'AutoClaw', status: '原订阅待核验' },
  { id: 'workbuddy', name: 'WorkBuddy', status: '自定义 API' },
  { id: 'traework', name: 'TraeWork', status: '原订阅待核验' },
  { id: 'codebuddy', name: 'CodeBuddy', status: '原订阅待核验' },
  { id: 'traecode', name: 'TraeCode', status: '原订阅待核验' },
  { id: 'opencode', name: 'OpenCode', status: '认证适配待实现' },
  { id: 'openclaw', name: 'OpenClaw', status: '认证适配待实现' },
  { id: 'sdk', name: 'OpenAI SDK', status: '独立 API' },
  { id: 'deepseek', name: 'DeepSeek', status: '独立 API' }
]

const subscriptionGuides: Partial<Record<ClientKind, { status: string; steps: string[]; warning: string }>> =
  {
    zcode: {
      status: 'GLM 原套餐入口已查证 · 网关未联调',
      steps: [
        '目标是保留智谱 / Z.ai 原有 Coding Plan。官方同时提供账户授权与 Coding Plan API Key 两种接入方式。',
        'Coding Plan Key 配合官方 Coding 专用地址可使用原套餐；这与通用 API 按量计费不同，也与自动复用现有登录不同。',
        '账户授权模式能否只改本地地址而继续自动登录、续期和计费，仍需核验。当前不生成会切换计费方式的命令。'
      ],
      warning: 'ZCode 桌面配置不会自动继承终端变量。原套餐的适用场景、地址和额度以智谱官方说明为准。'
    },
    autoclaw: {
      status: '智谱 AutoClaw · 原积分 / 登录待核验',
      steps: [
        '适配对象为智谱 AutoClaw，目标是保留应用中的账号、原积分或已绑定套餐。',
        '已查到自定义模型入口，但该入口使用模型服务凭据，不能据此确认内置积分请求会经过本地网关。',
        '待确认原登录请求的官方代理入口、完整请求位置和认证续期。当前不提供原积分转发命令。'
      ],
      warning: '自定义模型与 AutoClaw 内置积分是不同接入路径；尚未验证原登录流量。'
    },
    workbuddy: {
      status: '自定义 API 文本过滤 · 内置模型保持原连接',
      steps: [
        '在 WorkBuddy 的「设置 → 模型 → 添加模型」选择任意自定义供应商，填写原模型接口、模型名称与 API Key。Key 只需在 WorkBuddy 中填写。',
        '保存后返回此页检查配置，按模型启用过滤。App 保留各自来源和 Key，关闭工具、图片和思考能力。',
        '新建任务选择已接入的自定义模型，必要时重启 WorkBuddy。恢复直连会还原该模型原地址；内置模型不改动。'
      ],
      warning: '使用所选自定义 API 的认证与额度，服务商和模型名称不受 DeepSeek 限制。沿用 WorkBuddy 的聊天接口格式，流式回复保留代号；不接管内置会员模型。'
    },
    traework: {
      status: 'TRAE 国内版 · 原会员入口待核验',
      steps: [
        '目标是保留 TraeWork 原有会员、积分和登录。',
        '官方自定义模型功能仅限桌面版、本地任务；网页版、移动版与云端任务不能直接套用本机地址。',
        '会员内置模型能否在本地检查完整请求，仍需官方入口和客户端验证。当前不生成原积分转发配置。'
      ],
      warning: '自定义模型的 Base URL 不等于会员内置模型的代理地址；原订阅路径尚未验证。'
    },
    codebuddy: {
      status: '腾讯 CodeBuddy · 原会员入口待核验',
      steps: [
        '目标是保留 CodeBuddy 原有登录和额度，并分别核验 IDE、插件与 CLI。',
        '官方 models.json 文档描述的是自定义模型；CLI 的 CODEBUDDY_BASE_URL 通常与 API Key 配合使用。',
        '上述配置是否能保留会员认证、续期和原计费，目前没有验证证据，不直接生成替换配置。'
      ],
      warning: 'IDE、插件、CLI 的配置契约不同，不能用一个 API 地址模板宣称三个版本均已支持。'
    },
    traecode: {
      status: 'TRAE 国内版 · 原会员入口待核验',
      steps: [
        '目标是保留 TraeCode 内置模型的会员权益和原有登录。',
        '官方允许添加自定义模型，支持 OpenAI / Anthropic 格式；这条路径不证明原会员模型可以改地址。',
        '仍需核验完整 Prompt 在哪里形成，以及主模型、补全、索引与辅助请求能否纳入本地检查。'
      ],
      warning: '当前没有已验证的原会员转发配置。只检查用户输入不能覆盖后续附加的代码与工具结果。'
    },
    opencode: {
      status: '客户端支持订阅登录 · 网关适配待实现',
      steps: [
        'OpenCode 官方文档提供 ChatGPT Plus / Pro 登录入口；原账号由 OpenCode 自己管理。',
        '仍需针对实际版本确认订阅认证请求是否遵循自定义地址。OpenCode v1 与 v2 的 Provider 配置结构不同。',
        '需补齐订阅路由、工具协议和会话处理，再验证额度归属。当前不把通用 API 模板用于订阅登录。'
      ],
      warning: '客户端支持订阅登录，不代表已通过本项目验证，也不是模型服务商的免封承诺。'
    },
    openclaw: {
      status: '客户端支持原认证 · 网关适配待实现',
      steps: [
        'OpenClaw 文档区分 Codex 订阅认证、原生 Codex 运行时与独立 API 认证。',
        '原生运行时和内嵌运行时走不同调用路径，需逐一核验。Claude CLI 模式也应由原客户端管理登录。',
        '优先验证本机运行场景的原认证、工具循环和计费归属；云端 OpenClaw 不能直接访问本机回环端口。'
      ],
      warning: '当前未实现 OpenClaw 订阅网关适配。不会导入、复制或共享客户端保存的订阅凭据。'
    }
  }

const quote = (value: string, shell: ShellKind): string =>
  shell === 'powershell' ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\"'\"'") + "'"

export function generateGuide(
  client: ClientKind,
  shell: ShellKind,
  settings: Settings,
  token: string
): IntegrationGuide {
  const base = `http://127.0.0.1:${settings.port}`
  const env = (name: string, value: string) =>
    shell === 'powershell' ? `$env:${name} = ${quote(value, shell)}` : `export ${name}=${quote(value, shell)}`
  const sourceUrl = SOURCE_URLS[client]
  const common =
    '命令只影响当前终端及其子进程。重启 App 后需重新复制命令。本地通行凭据由 App 自动生成，不是模型服务的 Token。'
  const limit =
    '目前仅支持文本请求；工具调用、thinking、多模态和完整编码任务尚未适配。认证转发已用模拟上游验证，真实订阅账户尚未联调。'
  const pending = subscriptionGuides[client]
  if (pending) {
    return {
      title: CLIENTS.find((item) => item.id === client)!.name,
      status: pending.status,
      steps: pending.steps,
      code: '',
      sourceUrl,
      warning: pending.warning + ' 核对日期：2026-09-11；当前网关仅支持文本子集，完整 Agent 任务尚未适配。'
    }
  }
  if (client === 'codex') {
    const flags = [
      'model_provider="privacy_gateway_native"',
      'model_providers.privacy_gateway_native.name="Privacy Gateway"',
      `model_providers.privacy_gateway_native.base_url="${base}/native/codex"`,
      'model_providers.privacy_gateway_native.wire_api="responses"',
      'model_providers.privacy_gateway_native.requires_openai_auth=true',
      'model_providers.privacy_gateway_native.supports_websockets=false',
      'model_providers.privacy_gateway_native.env_http_headers={"X-Privacy-Gateway-Token"="PRIVACY_GATEWAY_TOKEN"}'
    ]
    return {
      title: 'Codex CLI',
      status: '原认证实验转发 · 真实订阅未联调',
      sourceUrl,
      steps: [
        '启用「沿用客户端认证」。无需在 App 填写上游 API Key。',
        '保留 Codex 已有的 ChatGPT 登录或 OpenAI API 认证，复制命令启动。命令不改写原配置文件，也不指定新模型。',
        '网关保留原认证头：有 ChatGPT 账户头时转发到 Codex 服务，其余转发到 OpenAI API。登录与续期仍由 Codex 负责。'
      ],
      code:
        env('PRIVACY_GATEWAY_TOKEN', token) +
        '\n' +
        'codex ' +
        flags.map((flag) => '-c ' + quote(flag, shell)).join(' '),
      warning:
        '无法承诺账号不会被限制或停用。官方 Codex 订阅登录不等于授权共享账号或绕过访问限制。' +
        limit +
        ' ' +
        common
    }
  }
  if (client === 'claude') {
    // 只追加本地通行头；不覆盖任何已有认证变量，也保留原有自定义 Header。
    const customHeaders =
      shell === 'powershell'
        ? `$env:ANTHROPIC_CUSTOM_HEADERS = (@($env:ANTHROPIC_CUSTOM_HEADERS -split "\u0060n" | Where-Object { $_ -and $_ -notmatch '(?i)^\\s*X-Privacy-Gateway-Token\\s*:' }) + ${quote('X-Privacy-Gateway-Token: ' + token, shell)}) -join "\u0060n"`
        : `export ANTHROPIC_CUSTOM_HEADERS="$(printf '%s\\n' "\${ANTHROPIC_CUSTOM_HEADERS-}" | sed '/^[[:space:]]*[Xx]-[Pp]rivacy-[Gg]ateway-[Tt]oken[[:space:]]*:/d')"$'\\n'${quote('X-Privacy-Gateway-Token: ' + token, shell)}`
    return {
      title: 'Claude Code',
      status: '原认证实验转发 · 真实订阅未联调',
      sourceUrl,
      steps: [
        '启用「沿用客户端认证」。已有 Claude 登录或 Anthropic API Key 继续由 Claude Code 管理。',
        '复制命令，只调整请求地址并自动加入本地通行头；不设置 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY。',
        '认证信息和 Anthropic 协议头仅转发到 api.anthropic.com，不写入日志，也不保存在 App。'
      ],
      code: [env('ANTHROPIC_BASE_URL', base + '/native/claude'), customHeaders, 'claude'].join('\n'),
      warning:
        '技术上可保留原登录，但 Anthropic 对第三方产品代用户转用订阅凭据有单独限制；原版 Claude Code / Agent SDK 场景应分别核验，不能承诺免封。' +
        limit +
        ' 如果此前执行过旧版命令，请在新的终端使用原来的认证环境。' +
        common
    }
  }
  const sdkSteps = [
    '在网关设置中选择模型服务，填写上游地址、模型和 API Key。',
    '复制环境变量到启动程序的终端；本地访问凭据会自动填入，无需手动输入。',
    'Python OpenAI SDK 可使用 OpenAI()；其他 SDK 如未自动读取变量，需显式指定 base_url / baseURL 和 api_key / apiKey。'
  ]
  const code = [
    env('OPENAI_BASE_URL', base + '/v1'),
    env('OPENAI_API_KEY', token),
    env('PRIVACY_GATEWAY_MODEL', settings.model)
  ].join('\n')
  return {
    title: client === 'deepseek' ? 'DeepSeek / SDK' : 'OpenAI SDK',
    status: '独立 API 配置 · 文本可用',
    sourceUrl,
    steps:
      client === 'deepseek'
        ? [
            '上游选择 DeepSeek，地址填写 https://api.deepseek.com/v1，填写已有 API Key 和可用模型。',
            ...sdkSteps.slice(1)
          ]
        : sdkSteps,
    code,
    warning:
      common +
      ' SDK 模式使用在 App 配置的服务凭据。流式响应保留代号。DeepSeek 网页版和官方聊天 App 不会读取这些变量。'
  }
}
