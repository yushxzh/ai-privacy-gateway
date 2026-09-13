# 客户端接入说明

最近更新：2026-09-13，版本 0.1.7。本文记录普通 API、WorkBuddy 自定义 API 及 Codex / Claude Code 实验入口。WorkBuddy 原登录的一键接入见 [使用指南](USAGE.md)，全部客户端的目标与状态见 [全局 PRD](PRD.md#客户端计划)。

**Codex / Claude Code 原认证仍只有模拟验证，完整编码任务未完成。** 生成命令不等于一键接入或真实订阅验收；历史政策调研见 [原订阅资料](SUBSCRIPTIONS.md)，使用前需按实际版本和平台条件重新核验。

WorkBuddy AI 5.5.2 的原登录 / Auto 文本过滤与一键恢复已在 macOS 实测。原生网络代理使用 `127.0.0.1:18788`；下述自定义 API 使用普通 API 入口，二者不能混填。Windows、付费套餐归属及完整工具循环尚未验收，见 [M1 交付记录](M1-DELIVERY.md)。

## 认证为什么不需要再填一份

模型服务认证仍然需要存在，但 Codex / Claude Code 已经持有的登录或 API 凭据无需复制到 App。客户端负责登录与续期，网关只在处理当前 HTTP 请求时转发对应认证头，不读取客户端凭据文件，也不把 Header 放入记录。

本地通行凭据与服务商认证分开：命令自动添加 `X-Privacy-Gateway-Token`，用于限制本机网关访问；该 Header 不发送给模型服务。App 不要求手动输入它，重启后重新复制命令即可。

| 模式 | 本地接入方式 | 模型服务认证 | 地址来源 |
| --- | --- | --- | --- |
| Codex / Claude Code 原认证转发 | 自动生成的独立 Header | 客户端原认证头 | 固定官方地址 |
| WorkBuddy 原生 HTTPS | 本机代理与证书信任 | WorkBuddy 原请求认证保持不变 | 原官方请求目的地 |
| OpenAI / DeepSeek SDK 配置模式 | 自动生成的 Bearer / x-api-key | App 中填写的上游 Key | App 中配置 |
| WorkBuddy 自定义 API | 每模型独立 URL 通行值 | WorkBuddy 当前请求的模型认证 | 该模型原服务 URL |
| 离线演示 | 自动生成的本地凭据 | 无 | 本机返回 |

## WorkBuddy 自定义 API

先在 WorkBuddy 保存自定义模型的原服务 URL、模型 ID 和 Key。在本网关「保护 → 连接一个应用 → WorkBuddy」选择对应模型并「启用过滤」，可同时启用多个不同来源，此操作不修改内置模型。API Key 继续由 WorkBuddy 管理；网关只随当前请求转发到该模型已保存的来源，不跟随跳转，不另存 Key。

每个模型有独立本地入口，支持「恢复直连」。接入状态在 App 重启后恢复。自定义模型被删除或地址改回原服务时自动撤销入口；必要时重启 WorkBuddy 以加载改过的配置。此接入不要求开启原生 HTTPS 保护，也不应把模型 API 地址填写到网络代理设置中。

当前协议范围为 OpenAI Chat Completions 文本格式，启用时关闭工具、图片与思考能力。WorkBuddy 的「自定义协议」开关决定是否自动补齐 URL 路径，不能据此把 Anthropic 等不同 JSON 格式视为兼容。来源不限定为 DeepSeek；真实商业 API 验证为 DeepSeek，其余来源的路由通过本地 HTTP 用例验证。

WorkBuddy 会把网关的 403 阻断提示成「鉴权失败」，以网关记录中的动作和原因判断。完整步骤见[自定义 API 接入](WORKBUDDY-CUSTOM-API.md)，此前真实 DeepSeek 请求证据见[0.1.3 联调记录](WORKBUDDY-DEEPSEEK.md)。

## Codex CLI

1. 在 App 的「保护 → 连接一个应用 → Codex CLI」启用「沿用客户端认证」。
2. 保留 Codex 已有登录，在同一终端执行生成的命令。
3. 命令为单次启动选择 `privacy_gateway_native` Provider，设置 `requires_openai_auth=true`，通过 `env_http_headers` 传入独立本地 Header，不设置 `env_key` 或覆盖模型选择。

Codex 官方源码明确区分服务商环境变量 Key 与原生登录认证，并通过 `ChatGPT-Account-ID` 携带账户上下文。[Provider 配置契约](https://github.com/openai/codex/blob/624ccf794703e2d84e748fc3ef547d6191a8c0a4/codex-rs/model-provider-info/src/lib.rs)、[认证头实现](https://github.com/openai/codex/blob/624ccf794703e2d84e748fc3ef547d6191a8c0a4/codex-rs/model-provider/src/bearer_auth_provider.rs)。

本地入口为 `/native/codex/responses`。收到 ChatGPT 账户头时转发到 `https://chatgpt.com/backend-api/codex/responses`，其余 Bearer 请求转发到 `https://api.openai.com/v1/responses`。原认证不经过用户自定义的上游 URL，不跟随重定向。专用地区、FedRAMP、企业 AgentAssertion 等账户路由尚未适配；客户端版本差异需单独验证。

当前只处理 Responses 文本子集，关闭 WebSocket，强制 `store: false`。工具定义、工具结果、加密推理和扩展参数仍返回 400，完整编码任务尚不可用。配置文件不被修改；退出该终端后恢复原启动方式。

## Claude Code

1. 在「保护 → 连接一个应用 → Claude Code」启用「沿用客户端认证」。
2. 保留 Claude Code 已有的 Claude 登录或 Anthropic API Key。
3. 复制命令。它仅设置 `ANTHROPIC_BASE_URL` 并在 `ANTHROPIC_CUSTOM_HEADERS` 中追加本地通行 Header，不设置或覆盖 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`。

官方兼容性文档说明：仅设置 Base URL 而未指定网关认证变量时，Claude Code 可以继续使用 claude.ai 登录；OAuth 所需的 `anthropic-beta` 必须保持完整。[Claude Code 协议要求](https://code.claude.com/docs/en/llm-gateway-protocol)

本地入口为 `/native/claude/v1/messages` 与 `/native/claude/v1/messages/count_tokens`，上游固定为 `https://api.anthropic.com`。保留 `Authorization`、`x-api-key`、`anthropic-*` 与 User-Agent，其他自定义 Header 默认不外发。

如果此前在终端执行过 0.1.0 的旧命令，先使用新的终端恢复原来的认证环境。App 不会自动删除用户已有的环境变量或改写 Claude 配置。[认证变量优先级](https://code.claude.com/docs/en/llm-gateway-connect)

目前仍仅支持文本请求；工具、thinking、多模态与完整编码流程未适配。

## OpenAI-compatible / DeepSeek SDK

SDK 模式继续使用单独上游配置。在「设置」选择服务，填写已有 API Key 与模型 ID；在 SDK 接入页复制环境变量即可，无需手动填写本地通行凭据。

Python SDK 示例：

```python
import os
from openai import OpenAI

# 使用明确地址，避免环境变量遗漏后意外直连默认服务。
client = OpenAI(
    base_url=os.environ["OPENAI_BASE_URL"],
    api_key=os.environ["OPENAI_API_KEY"],
)
response = client.chat.completions.create(
    model=os.environ["PRIVACY_GATEWAY_MODEL"],
    messages=[{"role": "user", "content": "请联系 demo.user@example.com"}],
)
print(response.choices[0].message.content)
```

DeepSeek 使用 Chat Completions；不假设其支持 Responses。官网聊天页面不读取这些 SDK 环境变量。[DeepSeek 官方文档](https://api-docs.deepseek.com/)

## 验证边界

已通过本地测试验证：原认证逐请求转发到固定目标、独立本地 Header 不外发、PII 与凭据按规则替换 / 阻断、认证 Header 不进入记录。生成的 Bash / Zsh 命令使用模拟客户端校验，不运行真实模型请求。

Codex / Claude Code 尚未用真实订阅完成端到端联调，也未完成工具协议。WorkBuddy 的实测范围单独记录。网关只覆盖实际经过对应入口且支持检查的模型请求，不自动覆盖客户端的遥测、更新、插件及其他出站路径。
