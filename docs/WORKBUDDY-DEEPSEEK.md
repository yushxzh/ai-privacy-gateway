# WorkBuddy → DeepSeek 文本过滤

版本：0.1.3；验证日期：2026-09-12。客户端：macOS / WorkBuddy AI 5.5.2；模型：自定义 `deepseek-flash`。

本文保留历史测试与操作。当前自定义 API 接入见 [WorkBuddy 自定义 API](WORKBUDDY-CUSTOM-API.md)，原登录一键接入见 [使用指南](USAGE.md)。

**真实主对话、多轮文本整理和凭据阻断已验证。** Key 由用户直接保存在 WorkBuddy；无需在 Privacy Gateway 再填一份。此次使用 DeepSeek API 通道，不代表 WorkBuddy 内置会员模型已接入。

## 配置顺序

1. WorkBuddy「设置 → 模型 → 添加模型 → 自定义」：填写 `https://api.deepseek.com/chat/completions`、`deepseek-flash` 和 DeepSeek API Key，保存模型。本次输出上限为 1024。
2. 本网关「接入应用 → WorkBuddy → 重新检查配置」。没有匹配配置时，启用按钮不可用；当前自动接入要求恰好一个匹配的 DeepSeek 自定义模型。
3. 点击「启用 WorkBuddy 过滤」。App 自动更新该模型的接口地址，保留 Key，并关闭工具调用、图片和思考能力，无需手动复制 Key。
4. 新建任务，选择自定义 `deepseek-flash`。客户端没有加载新配置时，重启 WorkBuddy。不要把本网关地址填入「网络代理」；本次保持「直接连接」。
5. App 重启后入口默认关闭，本地通行值重新生成。重新启用即可更新模型配置；WorkBuddy 必要时也需重启。
6. 恢复直连时，关闭过滤，将 WorkBuddy 模型接口恢复为上述 DeepSeek 官方地址，再重启 WorkBuddy。关闭过滤不会自动改回直连地址。

WorkBuddy 配置依据见[官方模型文档](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)，模型 API 见[DeepSeek 文档](https://api-docs.deepseek.com/)。

## 本机实测结果

测试使用合成邮箱 `apg.demo@example.com`、手机号 `13800138000` 和假密码，没有将真实 Key 放进消息正文。

| 时间（Asia/Shanghai） | 场景 | 实际结果 |
| --- | --- | --- |
| 00:34:03 | 单轮主对话，要求复述合成联系方式 | 网关完成替换并收到真实回复；模型识别到代号，但拒绝原样复述。证明连通和替换，不作为文本整理成功依据 |
| 00:42:21 | 同一任务继续要求整理两列表格，并保留隐私代号 | 真实回复成功，表格只有邮箱和手机号代号；网关记录为 MASK / 已完成，耗时 1783 ms |
| 00:44:28–00:44:29 | 新任务发送 `password=apgdemoonly123` | 产生两条密码阻断记录，覆盖标题辅助请求与主请求；主请求为 BLOCK / 已阻断，耗时 6 ms，未交给上游 |

多轮成功请求 ID：`b8a55a6d-8a8e-47a7-862d-ba1bec107365`。
主请求阻断 ID：`1df7ba44-01bc-4957-9eb6-f79d088f37b4`。

成功回复中的对应关系：

| 合成原值 | 发给 DeepSeek 的代号 |
| --- | --- |
| `apg.demo@example.com` | `⟦EMAIL_220d47f8b4ac5861⟧` |
| `13800138000` | `⟦PHONE_7492e68093322cd6⟧` |

上述代号也出现在 WorkBuddy 的真实表格回复中。SSE 当前保留代号，不自动恢复成原值；跨请求映射不保持稳定。

- [WorkBuddy 真实回复](assets/workbuddy-deepseek-reply.png)

网关对照与阻断截图含第三方请求上下文，仅保存在本机；公开记录保留上述合成数据、检测结果与请求 ID。

**WorkBuddy 5.5.2 会把本地 `403 privacy_blocked` 显示成「鉴权失败」。** 本次该提示由假密码触发；Key 已通过真实模型调用验证，无需重新填写。具体原因以本网关「请求记录」为准。

## 本次修复

- 支持桌面版实际保存的顶层模型数组，同时兼容 CLI 示例的 `models` 对象。
- 自动更新已有模型的 URL 与文本能力，保留 Key、输出上限及其他模型；配置写入设为仅当前用户可读写，并检测并发编辑。
- 即使关闭工具能力，WorkBuddy 仍会附带工具声明。文本入口会整项移除，不向上游发送；实际工具调用与工具结果仍被拒绝。
- 移除 WorkBuddy 消息内部的来源、用量与追踪元数据，修复单轮及多轮的 400 请求格式错误；未知字段继续拒绝。
- WorkBuddy 记录保留检测前后的文本请求，去除无关工具声明。长记录保留开头与结尾，原文和替换预览各最多 24,000 个字符，便于核对最新输入；检测使用完整文本。

## Key 与请求边界

- WorkBuddy 保存 Key，并将其放入当前请求的 Bearer 头。本网关从该请求临时取用，只转发到固定 DeepSeek 官方 HTTPS 地址，不跟随重定向，不保存或展示认证 Header。
- 配置检查和自动接入会在主进程解析 WorkBuddy 已有配置文件；不会将 Key 传入页面、另存到网关设置或写入审计记录。更新原配置文件时保留其中的 Key。
- 专属 URL 的随机通行值只用于本机鉴权，不发送给 DeepSeek，不出现在请求记录中。
- 检测覆盖受支持的文本字段。邮箱、手机号等命中后替换，凭据正文命中后阻断。工具执行、工具结果、图片、文件、开启思考和未知扩展字段尚不支持。
- 非流式 JSON 支持本地代号恢复；SSE 保留代号。本网关的原文、记录及映射默认仅留在进程内存，退出后清空。WorkBuddy 自身的历史、日志、遥测与其他网络路径不属于该保证。
- 模型调用使用 DeepSeek API 凭据及额度。WorkBuddy 自身的辅助请求和积分以实际账单为准；本次未核算费用，也不对账号限制风险作出保证。

## 检查与运行状态

| 验证项 | 结果 |
| --- | --- |
| 类型检查与检测 / HTTP 测试 | 32 项测试通过，包括多轮元数据移除、PII 替换、凭据阻断、固定目标及认证隔离 |
| Electron 交互回归 | 同轮 1 项通过；最终网关变更另由上述测试和真实客户端请求验证 |
| macOS arm64 构建启动 | 0.1.3 应用实际启动，本地端口 8787；当前记录包含 1 条成功替换、2 条凭据阻断 |
| 临时诊断入口 | 已关闭 18789，WorkBuddy 地址恢复到 8787；Key 仍在客户端配置中，文件权限为 0600 |
| 完整工具循环、图片、Windows 真机 | 尚未支持或验证 |

当前本机应用目录：`release/workbuddy-final/mac-arm64/AI Privacy Gateway.app`。已更新 README、MVP、架构、接入和验证文档。未重建 DMG / Windows 安装包，未执行 commit、push、部署或公开发布。

此前[原登录 CONNECT 连通测试](WORKBUDDY-VALIDATION.md)保留为独立证据，不属于内容过滤验收。
