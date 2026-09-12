# 原生订阅本地过滤：官方入口与验证门槛

核对日期：2026-09-12。目标是保持官方客户端、原有订阅或 Coding Plan、原模型与原计费，在完整模型请求离开本机前检查和处理敏感内容。本轮仅检查源码、版本与公开官方资料，未读取真实认证文件或 Token，未发送模型请求。

## 结论与项目现状

**原生 Codex 是优先验证对象，WorkBuddy 内置会员是独立的可行性门槛。** 自定义 API 与 DeepSeek 文本过滤已经提供了另一种可用入口，但不能替代这两个目标。

本地静态检查确认：[认证转发实现](../src/gateway/client-auth.ts)仅接收客户端随请求携带的认证，固定官方上游；[启动配置](../src/shared/integrations.ts)已有 Codex / Claude 原认证实验入口。[协议处理](../src/gateway/protocol.ts)仍只接受文本子集，会拒绝工具、推理和会话扩展。因此，模拟测试不能证明完整编码任务或原订阅可用。[WorkBuddy 既有记录](WORKBUDDY-VALIDATION.md)仅证明 5.5.2 Free 登录下 CONNECT 连通；内置模型的内容过滤与付费会员未验证。本轮未复测这些历史记录。

## Codex：自定义 Provider 可以保留原登录

**已证实。** OpenAI 官方区分 ChatGPT 登录的订阅访问和 API Key 的按量访问；本地 Codex 客户端支持两类认证。配置自定义 Provider 时，`requires_openai_auth=true` 明确允许继续使用 ChatGPT 登录，官方也将 LLM proxy 列为用途；`env_key` 是另一种认证选项。因此，「自定义 Provider」不能一概解释为「另买 API」。[官方认证说明][oai-auth]

可研究的官方入口包括 Provider 的 `base_url`、`wire_api="responses"`、附加 Header，以及内置 OpenAI Provider 的 `openai_base_url`。本机 `codex --version` 返回 `0.147.0`；官方 `rust-v0.147.0` 源码也定义了订阅认证和 WebSocket 能力开关。[高级配置][oai-config]、[固定版本源码][oai-source]

**边界。** 改地址并未证明辅助请求、压缩、续接或桌面任务全部经过网关。`chatgpt_base_url` 的配置说明涉及登录及 ChatGPT 服务，不是全量网络覆盖承诺；沙箱网络代理主要控制命令出站，也不能充当完整模型过滤证明。[配置参考][oai-reference] Codex 桌面本地任务应单独验证实际使用的运行时、配置加载与请求覆盖；普通 ChatGPT 聊天、网页及云端任务不能直接继承 CLI 验收结论。App Server 是客户端集成协议，提供账号类型和额度查询；它本身并非出站内容过滤器。[App Server][oai-app-server]

**推断。** 固定官方客户端版本、由客户端继续登录和续期、通过官方配置转交本地网关，是值得实施 PoC 的路线。能否保持所选模型、功能和实际额度归属仍需实测；未核实用户具体套餐、币种或价格。

## Claude Code：技术机制与产品许可分开核验

**已证实。** 官方明确：只设置 `ANTHROPIC_BASE_URL`，不设置网关认证变量或 `apiKeyHelper`，已保存的 claude.ai 登录仍有效，原订阅用量限制和计费继续适用；网关必须保留 `anthropic-beta` 中所需的 OAuth 能力。[订阅与网关][claude-gateway] 完整兼容还涉及工具、缓存、上下文管理、thinking 签名和错误回包，不能只转发文本。[协议要求][claude-protocol]

官方法律说明同时限制第三方产品代用户转用 Free / Pro / Max 凭据，以及收集、存储或中介 claude.ai 凭据；用户自行登录未修改的官方 Claude Code 属于另一种明确列出的情形。[认证与产品使用限制][claude-legal] **尚未确认本网关面向公众发布时的许可边界。** 本机自用技术验证不能自动推出可作为第三方产品大规模分发；应按具体部署、凭据接触方式与商业模式向 Anthropic 核对，不能承诺免封。

## WorkBuddy：内置会员明文入口尚缺证据

**已证实。** 国际版官方文档分别描述内置模型和自定义模型；后者配置 URL、API Key、模型名称，支持本地 HTTP 服务。「Custom Protocol」仅跳过 URL 路径校验与补全，未说明会复用内置会员认证。[模型配置][wb-model]

官方 CLI 文档的 `CODEBUDDY_BASE_URL` 通常与 `CODEBUDDY_API_KEY` 配合；`HTTP_PROXY` / `HTTPS_PROXY` 是网络代理配置。它们不能直接证明 WorkBuddy 桌面内置会员遵循同一端点契约。[CLI 环境变量][wb-env] 插件文档列出 `UserPromptSubmit`、工具及会话事件，但未据此建立「每次最终模型请求发送前可完整替换正文」的契约；单次输入事件不能保证覆盖之后附加的文件、记忆和工具结果。[插件事件][wb-hooks]

**未验证。** 本轮在上述官方模型、端点和插件资料中，未找到可同时保留 WorkBuddy 内置会员、截取并修改完整明文请求的明确入口。这是证据缺口，不能写成绝对不可能。CONNECT 原样转发 TLS 只能处理加密连接；如果另行研究 TLS 解密，会改变证书信任和凭据可见范围，需要独立设计及授权。

## 推荐验证顺序与退路

以下是验收建议，尚未执行，也不构成工期承诺。

1. **先完成固定版本 Codex CLI PoC。** 使用未修改的官方客户端和独立测试目录，由用户保持本人 ChatGPT 登录；记录版本、系统、实际模型、认证类型及官方额度状态。以合成敏感标记完成「读取文件 → 修改 → 工具结果回传 → 验证 → 续接」的真实完整任务。
2. **同时证明过滤与兼容。** 逐请求证明处理发生在发往官方服务之前；覆盖系统上下文、工具定义与结果、SSE、取消、重试、压缩和恢复。验证阻断后无上游调用，代号跨请求稳定且不破坏文件路径与工具参数。加密或签名内容需明确保留条件、不可检查范围和失败策略，不能以原样放行未知内容宣称全部已过滤。
3. **证明原权益保留。** 核对原登录续期、实际服务路由与原订阅额度；若认证类型或计费去向不符则停止。遇到协议拒绝不得静默直连或切换到独立 API；凭据不进入日志。通过后再分别验收 Codex 桌面与其他客户端。
4. **对封闭客户端先设进入条件。** WorkBuddy 等须先取得官方端点或拦截契约，再证明完整请求覆盖、原认证续期和原额度归属；缺一项仍标记「待验证」。Claude 还需要明确产品使用许可。

若入口或许可不成立，保留该客户端的「原会员过滤未支持」状态。可以另行提供用户主动选择的自定义 API 模式，或在隔离工作区中预处理资料，但必须写明不同认证、费用或覆盖限制；不能将这些替代方式算作原目标完成。

[oai-auth]: https://learn.chatgpt.com/docs/auth
[oai-config]: https://learn.chatgpt.com/docs/config-file/config-advanced
[oai-source]: https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/model-provider-info/src/lib.rs
[oai-reference]: https://learn.chatgpt.com/docs/config-file/config-reference
[oai-app-server]: https://learn.chatgpt.com/docs/app-server
[claude-gateway]: https://code.claude.com/docs/en/llm-gateway#subscriptions-and-gateways
[claude-protocol]: https://code.claude.com/docs/en/llm-gateway-protocol
[claude-legal]: https://code.claude.com/docs/en/legal-and-compliance
[wb-model]: https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model
[wb-env]: https://www.workbuddy.ai/docs/cli/env-vars
[wb-hooks]: https://www.workbuddy.ai/docs/zh/cli/plugins-reference
