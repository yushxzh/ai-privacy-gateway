# 原订阅接入：账号风险与兼容性

原订阅政策核对日期：2026-09-11。以下矩阵保留原登录验证边界。2026-09-12 的 0.1.4 已实现 [WorkBuddy 自定义 API 文本过滤](WORKBUDDY-CUSTOM-API.md)，不限制供应商；内置会员模型仍保持原连接。自定义 API 使用各服务自己的认证和额度，不作为原订阅接入完成的依据。

## 当前结论

无法承诺通过本网关使用订阅不会触发账号限制或停用，也没有可靠依据给出封号概率。目前不存在「接上本地代理就一定封号」的官方结论；官方支持某种登录或代理配置，也不代表本项目已经获得平台认可。

当前版本尚不适合完整编码任务：它只有文本协议子集，实际工具调用、工具结果、推理及会话扩展会被拒绝。Codex / Claude Code 原认证只经过模拟上游验证。WorkBuddy 已完成原登录下的网络连通测试，但内置模型未接入隐私过滤，见[原登录实测记录](WORKBUDDY-VALIDATION.md)；自定义 API 的过滤是独立入口。

本项目的「支持」至少同时满足：原有登录继续有效、完整模型请求在本机接受检查、工具与会话正常运行、使用的额度与预期一致。增加客户端卡片、提供 API 地址或完成一次文本请求，都不足以证明上述能力。

## ChatGPT 订阅与 Codex

OpenAI 官方支持 Codex 使用 ChatGPT 登录获取订阅访问，也支持 API Key 按量访问；两者的计费和管理边界不同。配置文档提供自定义 Provider、地址和 Header 入口。这些资料说明可以研究本地网关接入，但没有给出本网关的账号安全保证。[认证](https://learn.chatgpt.com/docs/auth)、[高级配置](https://learn.chatgpt.com/docs/config-file/config-advanced)

OpenAI 列举的停用原因包括违反使用政策、绕过访问限制、不当共享账号或密钥等；疑似账号被盗也可能触发临时限制。本机隐私检查不应改变账号主体、伪造客户端身份、绕过额度或把账号变成共享服务。[账号停用说明](https://help.openai.com/en/articles/10562188)

本项目当前只逐请求转发 Codex 已携带的认证头，并固定官方上游；不读取 `auth.json` 或系统密钥库，不代替客户端登录或刷新凭据。独立本地通行 Header 不发送给上游。上述实现能减少凭据泄漏面，不能消除平台条款和风控风险。

收到 400、401、403 或 429，不能仅凭状态码判断账号已被封：本地协议拒绝、登录过期、权限不足、额度限制都需分别排查。当前网关会折叠上游错误细节，这是后续诊断能力需要补齐的部分。

当前建议先用合成内容与模拟认证补齐本地协议用例，再进行单客户端、单任务的真实订阅联调。401 / 403 先停止并核对官方客户端状态；429 遵守服务方限制，不通过重试、切换身份或共享凭据规避。测试通过只能证明该版本和场景运行正常，不能证明以后不会被限制。

## Claude 订阅需要单独判断

Claude Code 的网关协议文档明确描述了保留 claude.ai 登录的技术机制。与此同时，法律说明限制第三方产品代用户转用订阅凭据，允许用户在未修改的官方 Claude Code 中按官方流程自行登录；这两种场景不能混为一谈。[网关协议](https://code.claude.com/docs/en/llm-gateway-protocol)、[认证与产品使用限制](https://code.claude.com/docs/en/legal-and-compliance)

Anthropic 的 2026-06-15 更新暂停了此前公布的 Agent SDK 计费改动；帮助文档当前写明 Agent SDK、`claude -p` 与相关第三方应用使用仍计入订阅限制。不能把已暂停的方案写成生效规则，也不能据此推断任意凭据转发都获准。[Agent SDK 与订阅的最新说明](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

本轮用户选择测试 ChatGPT 订阅，未进行 Claude 真实账户联调。Claude Code 在 App 中保留「实验转发」标记。

## 十个平台的原订阅接入矩阵

下表描述官方公开入口与本项目的实际状态。所有客户端均未通过本网关的真实订阅端到端验收。

| 客户端 | 目标权益 | 已查证的入口 | 本项目结论与缺口 |
| --- | --- | --- | --- |
| ZCode | 智谱 / Z.ai 原 Coding Plan | 账户授权；官方 Coding Plan API Key；自定义模型地址 | 原套餐可走官方 Coding 专用 API；账户授权模式能否只改地址并保留自动登录待核验。不是新增按量 API 账户的同义词 |
| AutoClaw | 智谱 AutoClaw 原积分、绑定套餐和登录 | 自定义模型的 Base URL、API Key、模型配置 | 原积分模型的出站代理、认证续期及 Prompt 处理入口待核验；自定义模型接入不证明原积分可转发 |
| Claude Code | Claude 原订阅或既有 API 认证 | `ANTHROPIC_BASE_URL` 和自定义 Header | 已实现模拟认证转发；真实账号、查询参数、工具、thinking、缓存和会话均待适配 |
| Codex | ChatGPT 原订阅 | 官方登录、自定义 Provider、Header | 已实现模拟认证转发；优先补齐 Responses 工具循环、推理、会话与真实计费验证 |
| WorkBuddy | 腾讯 WorkBuddy 原会员和积分 | 本机 WorkBuddy AI 5.5.2 提供网络代理 | Free 原登录与 Auto 模式在本地 CONNECT 代理下调用成功，显示消耗 1.76 积分；内容仍加密，未实现隐私过滤，付费会员未验证 |
| TraeWork | TRAE 国内版原会员和积分 | 桌面版、本地任务的自定义模型 | 原会员入口待核验；不能把桌面本地配置套用于网页版、移动版或云端任务 |
| CodeBuddy | 腾讯 CodeBuddy 原会员和登录 | IDE 自定义 `models.json`；CLI 有端点环境变量 | IDE、插件和 CLI 必须分别核验；端点变量与 API Key 配合使用不能证明原会员认证可复用 |
| TraeCode | TRAE 国内版原会员和积分 | 自定义 OpenAI / Anthropic 模型 | 原会员内置模型代理入口待核验；补全、索引与辅助调用需分别确认覆盖范围 |
| OpenCode | 当前已连接的服务商订阅或登录 | 官方文档提供 ChatGPT Plus / Pro 登录、自定义 Provider 地址 | 原认证如何经过网关需按版本核验；v1 与 v2 配置结构不同，不能只套用通用 API 示例 |
| OpenClaw | 当前已连接的服务商订阅或原客户端登录 | Codex 订阅认证、原生 Codex 运行时、Claude CLI 等入口 | 内嵌与原生运行时分别适配；本机部署优先；远程部署不能直接访问用户电脑的回环端口 |

### 官方证据

- ZCode：[连接模型与套餐](https://zcode.z.ai/cn/docs/configuration)、[常见问题](https://zcode.z.ai/cn/docs/qa)。账户授权会自动选择地址，桌面配置与终端变量独立。Coding 专用地址与通用 API 地址不能混用。
- AutoClaw：用户指定的[官网](https://autoclaw.z.ai/)在本轮读取超时；腾讯云提供了[AutoClaw 接入自身模型服务的官方教程](https://intl.cloud.tencent.com/zh/document/product/1300/81504)，可佐证自定义模型入口，不能作为智谱原积分转发许可。教程正文检索可见，直接打开也有失败，仍需客户端复核。
- WorkBuddy：本机安装的是 [WorkBuddy AI](https://www.workbuddy.ai/) 5.5.2。网络代理入口与原登录调用已有本机证据，详见[实测记录](WORKBUDDY-VALIDATION.md)。国内版自定义模型文档不能直接作为本版本内置模型的适配契约。
- TraeWork：[模型](https://docs.trae.cn/work_models)。明确自定义模型仅支持桌面版及本地环境。
- CodeBuddy：[IDE 模型配置](https://www.codebuddy.cn/docs/ide/Features/models)、[CLI 环境变量](https://www.codebuddy.cn/docs/cli/env-vars)。CLI 的 `CODEBUDDY_BASE_URL` 通常与 `CODEBUDDY_API_KEY` 配合使用。
- TraeCode：[内置模型与自定义模型](https://docs.trae.cn/ide_models)。自定义 API 与会员内置模型在文档中分开描述。
- OpenCode：[Provider 与 ChatGPT 登录](https://opencode.ai/docs/providers)、[v2 Provider 配置](https://opencode.ai/v2/docs/providers)。OpenCode 的登录说明属于客户端方技术证据，不作为 OpenAI 对本项目的账号安全保证。
- OpenClaw：[OpenAI 入口](https://docs.openclaw.ai/providers/openai)、[Claude CLI 入口](https://docs.openclaw.ai/providers/anthropic)、[自定义 Provider](https://docs.openclaw.ai/concepts/model-providers/custom-providers)。客户端方对支持范围的说明仍需与模型服务方规则一起判断。

## 适配顺序与验收

1. **WorkBuddy 自定义 API 已先行实现。** 用户选择仅接管自定义来源；内置模型保持原连接。CONNECT 只能转发加密连接，不能满足内容过滤要求。
2. **继续完善 Codex 原订阅接入。** 固定客户端版本；用合成认证和请求验证 Responses、工具定义与结果、SSE、取消、限流和会话续接。真实订阅联调单独执行，核对官方用量页面。
3. **适配 OpenCode / OpenClaw 的既有登录。** 分别选择当前客户端的原生认证入口，核验 Base URL 覆盖是否作用于实际推理请求，避免退回独立 API 计费。
4. **Claude Code 单独处理。** 保留官方客户端认证边界；根据协议要求处理 beta、查询参数、缓存、签名和扩展字段。技术接入与产品使用许可分别核验。
5. **推进其余五个平台的原会员入口。** 需要官方代理、插件或请求拦截接口，并证明检查发生在完整模型请求离开本机之前。没有这些证据时保持待核验，不用自定义 API 或单次用户输入 Hook 代替。

对每个平台均需记录：客户端版本与系统、账号套餐、官方配置入口、认证归属、实际目标地址、完整请求覆盖范围、工具与会话行为、额度归属、撤销配置方式。

真正启用 MASK 前，还需验证代号在同一会话中稳定、工具参数恢复与签名边界。当前代号逐请求变化，SSE 不恢复；直接应用到编码 Agent 可能改变文件路径、工具参数或后续上下文。不能通过原样放行未知字段来换取「看起来能用」。

## 本轮交付状态

已补充十个平台的原订阅接入清单，保留两个 SDK 入口作为独立 API 功能。WorkBuddy 在临时网络代理下完成一次真实调用，界面显示消耗 1.76 积分；网络设置已恢复，未读取明文凭据。新增八个平台的原订阅隐私过滤尚未实现。

这是一份接入决策与验收基线，不是十个平台已完成适配的声明。完整协议适配和逐客户端真实联调仍是后续工作。
