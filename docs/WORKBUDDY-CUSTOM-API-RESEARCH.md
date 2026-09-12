# WorkBuddy 自定义 API 官方资料核查

核查日期：2026-09-11。目标客户端：腾讯国际版 WorkBuddy AI 5.5.2。证据包括官方文档、腾讯公开源码、本机 UI 和安装包静态核对结果。本轮未修改模型配置、读取账户凭据或发送模型请求。

后续已按用户选择实现「自定义 DeepSeek、Key 保留在 WorkBuddy」的专属入口和条件开关。以下为初次资料核查记录；当前操作步骤与验证状态以 [WorkBuddy → DeepSeek 接入](WORKBUDDY-DEEPSEEK.md) 为准。

## 结论

**WorkBuddy 官方支持自定义 API，而且明确支持本地 HTTP 模型服务。** 应检查「设置 → 模型」中的自定义模型入口。此前的网络代理连通测试没有覆盖这条可提供请求正文的入口，不能作为隐私网关接入的验收结果。[国际版模型配置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)

**「自定义 API 可接入」与「原 WorkBuddy 登录及积分可继续使用」仍是两个结论。** 已核查资料未明确说明，内置会员模型可以改成本地 URL，并自动把原登录认证和额度转交给这个地址。不能据此宣称可保留原订阅，也不能将未找到说明写成「官方绝对不支持」。

**已有官方明文入口，可以进入真正的适配；当前网关还不能承诺运行完整 WorkBuddy 任务。** 本机自定义模型默认启用工具调用，而现有 `src/gateway/protocol.ts` 拒绝 `tools`、`tool_choice` 和 `tool` 消息。只填写 URL 不会消除这项协议差异。

## 本机 5.5.2 已核对

通过只读 UI 检查确认：

- 设置 → 模型 → 添加模型 → 供应商列表 → 其他 → 自定义。
- 当前自定义模型列表为空；界面显示保存路径为 `~/.workbuddy-ai/models.json`。
- 表单包含接口地址、API Key、模型名称；接口地址占位符使用完整 `/v1/chat/completions` 路径。
- 高级配置包含工具调用（默认勾选）、图片输入、思考模式、自定义协议（默认未勾选），以及输入、输出上下文大小。

官方安装包 `app.asar/cli/dist/codebuddy-headless.js` 的静态检查还确认：`ModelProvider` 使用配置中的 `url`，`useCustomProtocol` 控制地址是否补全，`getCustomHeaders` 从选中模型的 `apiKey` 构造 Bearer 认证。此证据支持「使用自定义模型认证值」，不支持「自动沿用原会员认证」。检查期间没有保存模型。

## 国际版官方入口

| 配置项 | 官方说明 | 对本项目的含义 |
| --- | --- | --- |
| 入口 | Settings → Model；支持新增、编辑、删除自定义模型 | 优先通过 UI 核验当前版本 |
| Custom | 手动填写 URL、API Key、模型名称 | 可以填写网关的模型接口地址 |
| 默认地址处理 | 校验并补全 `/chat/completions` | 不应把网络代理 URL 当模型 URL |
| Custom Protocol | 跳过路径校验和补全，直接请求填写的 URL | 是地址处理开关，文档没有说它会转换 API 协议 |
| 本地服务 | 官方提供 Ollama 接入方式，使用本地 HTTP / OpenAI 兼容接口 | localhost HTTP 本身不是官方禁止的接入方式 |
| 能力设置 | 提供商预设可填写工具、图片、推理能力标记 | 仍须按网关真实能力配置和测试 |

以上来自[国际版模型配置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)，本机入口与字段已按上一节核对。

根据已知网关路由，候选完整接口为 `http://127.0.0.1:8787/v1/chat/completions`。这是本项目的接入建议，尚不是 WorkBuddy 联调通过的记录。填写到 WorkBuddy 的 Key 可以是本地网关的访问凭据；真实远端模型如何认证，仍需由网关上游方案解决。

供后续离线适配使用的字段草案，尚未保存或验证：

```text
接口地址：http://127.0.0.1:8787/v1/chat/completions
API Key：<网关生成的本地访问凭据>
模型名称：privacy-demo
```

`privacy-demo` 仅用于当前本地演示。真实模型应填写实际模型标识。不要在 WorkBuddy 中复制平台登录 Token；关闭工具能力开关是否足以产生网关接受的纯文本请求，也必须实测。

## models.json 的准确字段与范围

腾讯 CodeBuddy 官方配置文档的地址字段名是 `url`，要求完整接口路径，并给出了 `http://localhost:11434/v1/chat/completions` 示例。该文档声明这条配置通道使用 OpenAI 格式。[models.json 配置指南](https://www.codebuddy.cn/docs/cli/models)

| 字段 | 作用 |
| --- | --- |
| `models` | 自定义模型数组 |
| `id` | 模型标识 |
| `name` | 显示名称 |
| `vendor` | 供应商标记 |
| `url` | 完整模型请求地址；不是该文档中的 `baseURL` 或 `base_url` |
| `apiKey` | 该模型服务的认证值 |
| `supportsToolCall` | 工具调用能力标记 |
| `supportsImages` / `supportsReasoning` | 图片、推理能力标记 |
| `maxInputTokens` / `maxOutputTokens` | 输入、输出容量设置 |

上述字段来自[腾讯官方配置结构](https://www.codebuddy.cn/docs/cli/models)。该文档还支持以相同 `id` 覆盖模型定义，但其自定义端点示例同时配置自己的 Key；这不能证明会继承会员认证。

国际 WorkBuddy 文档说明旧 `~/.codebuddy/models.json` 配置可继续使用；国内 WorkBuddy 文档同时使用 `workbuddy/models.json` 描述存储位置。它们与本机 UI 显示的 `~/.workbuddy-ai/models.json` 不能混为一个固定路径。CLI 的环境变量解析规则也不能直接当成国际桌面版的已验证行为。[国际版模型配置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)、[国内版模型配置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)

## Key、登录和额度

| 路径 | 已确认 | 未确认 |
| --- | --- | --- |
| 国际 WorkBuddy 内置模型 | 官方账户文档提供登录和产品积分机制 | 改写内置模型 URL 后，认证与原积分能否保留 |
| 自定义远端模型 | WorkBuddy 自定义入口要求填写模型服务的 API Key | 不能把这个字段解释为自动提取 WorkBuddy 登录 Token |
| 本地模型 | 官方 Ollama 示例不需要付费模型 Key | 不代表云端内置模型也能免 Key 转发 |
| CodeBuddy CLI 平台 API | 官方另有平台 API Key 和 OAuth 认证说明 | 与国际 WorkBuddy Free / Pro 的凭据、额度是否互通，不能跨产品推定 |

登录与积分依据：[国际版 FAQ](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/FAQ)、[国际版积分说明](https://www.workbuddy.ai/docs/workbuddy/credits)。CLI 认证依据：[CodeBuddy 身份与访问管理](https://www.workbuddy.ai/docs/cli/iam)。自定义入口依据：[国际版模型配置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)。

国内 WorkBuddy 文档明确，自定义模型的模型费用由第三方结算；其 Token Plan 接入也要求套餐对应的 API Key。国内企业模型管理文档则区分官方模型和自定义模型，官方模型的编辑仅涉及可见范围。它们支持「认证和费用应按通道区分」的判断，但不能直接充当国际版账户的计费条款。[国内版模型配置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)、[国内企业模型管理](https://www.codebuddy.cn/docs/enterprise/adminguide/%E6%A8%A1%E5%9E%8B%E7%AE%A1%E7%90%86)

核查国际版模型页、定价页、积分页与 FAQ 后，未找到自定义 API 的专门扣分条款；国际服务协议仅一般性说明第三方服务适用各自条款。因此不能向当前国际版 Free 账户承诺「不扣 WorkBuddy 积分」或「继续扣原会员额度」。这是资料缺口，并非否定结论。[国际版定价](https://www.workbuddy.ai/docs/workbuddy/pricing)、[国际版积分](https://www.workbuddy.ai/docs/workbuddy/credits)、[国际服务协议 §3.6](https://www.workbuddy.ai/document/term)

## 协议与验收边界

腾讯自己的 `workbuddy-bench` 仓库展示了 CodeBuddy Code 的本地模型代理方案：`models.json` 指向代理的完整 Chat Completions 地址，客户端使用测试 Key，上游 Key 单独由代理配置。它证明腾讯公开工具链中确有这种代理架构；它评测的是 CLI，不能代替国际 WorkBuddy 桌面版、原订阅或本项目的兼容性测试。[腾讯官方评测工具配置](https://github.com/Tencent/workbuddy-bench/blob/main/configs/harnesses/codebuddy-code/CONFIG.md)

CodeBuddy CLI 的环境变量文档还描述了 `CODEBUDDY_BASE_URL` 及兼容 Anthropic 服务的用法。这是 CLI 的另一配置通道；不能因为同一文档站存在这段说明，就断言 WorkBuddy 自定义模型 UI 会发送 Anthropic Messages。[CLI 环境变量参考](https://www.workbuddy.ai/docs/zh/cli/env-vars)

本轮资料未给出 WorkBuddy 5.5.2 自定义模型的完整请求 Schema、SSE 事件、工具结果往返、取消与重试契约。需要用本机的最小合成请求核验：

1. URL 保存后是否确实请求本地完整路径，且请求认证只使用配置的本地凭据。
2. 首轮请求是否包含工具定义、系统上下文、推理或扩展字段；不能只检查用户输入一句话。
3. 替换后的正文是否确实发给上游，阻断时是否停止上游调用，流式响应是否正确结束。
4. 后续工具结果、辅助模型和自动重试是否仍经过网关。
5. 若测试目标仍是原订阅，需要另外证明官方认证的使用方式及实际额度归属。

这些是本项目的验收建议，均未在本轮执行。先用离线回包验证自定义入口和真实请求形状，不需要为此取得或读取用户的云端凭据。

## 记录范围

本轮只新增本文，未修改客户端配置、网关实现或账户资料；没有发送模型请求，未执行 commit、push 或发布。部分国际站 CLI 页面直接打开超时，相关条目仅采用搜索服务返回的同一官方页面正文；未采用第三方逆向代理、Cookie 导出方案或其他厂商同名产品作为支持证据。
