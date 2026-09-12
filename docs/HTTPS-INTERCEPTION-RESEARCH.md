# 本机 HTTPS 解密代理：可行条件与边界

核对日期：2026-09-12。依据 mitmproxy 当前 stable 文档、项目源码及平台官方资料。本轮仅研究和检查本地源码，未安装证书、修改代理或客户端配置、抓取现有流量、读取认证或发送模型请求。

**这是一条值得验证的新增接入路线。** 成熟代理可以统一接收原客户端流量，在本机解密后交给隐私规则处理，再连接原官方服务，减少逐客户端修改模型 URL 的工作。但必须分别证明「流量经过代理、客户端接受证书、正文能够正确修改、原功能与原权益仍成立」。目前不能据此宣布 WorkBuddy 已兼容。

## 1. 信任证书和主动代理分别解决什么

安装 CA 只是允许客户端接受代理签发的目标网站证书；它不会自动改变网络路径，也不会让旁观的进程读到所有 HTTPS。还需要显式代理配置，或操作系统层面的流量重定向。普通 CONNECT 只转发密文；mitmproxy 则分别与客户端、官方服务器建立 TLS 连接，在中间处理明文。[代理机制][mechanism]

```text
官方客户端（继续自行登录、选择模型）
  → 本机显式代理 / 本地流量捕获
  → TLS 解密 → 定位正文 → 隐私检查与替换 → 重新编码
  → TLS 连接原官方服务
```

**工程推断：** 若原上游、认证、模型字段和会话语义保持有效，代理机制本身不要求改用另一套 API Key；原额度归属仍须用官方客户端和服务端结果验收。证书不会增加会员权限，也不能证明账号不会被限制。

## 2. Windows 与 macOS 的接入选择

| 方式 | 平台与边界 | 对本项目的意义 |
| --- | --- | --- |
| Regular 显式代理 | 客户端配置 HTTP(S) 代理；部分应用会忽略系统设置 | 已有客户端代理入口时，优先验证；仍不需要改模型 URL |
| Local Capture | Windows、macOS、Linux；可按进程名或 PID 捕获本机流量 | 可减少应用配置，但仍需证书信任和平台安装支持 |
| 传统 Transparent 模式 | Linux、macOS；依赖自定义网络路由，当前不支持 UDP | 与 Local Capture 是不同模式，不作为 Windows 通用入口 |
| WireGuard / TUN | WireGuard 更适合外部设备；不能直接捕获代理所在主机的全部流量；TUN 模式仅 Linux | 不能把「配置一个 VPN」视为 Windows/macOS 本机方案已经完成 |

以上范围以 [Proxy Modes][modes] 为准。官方优先推荐 Regular、Local Capture 等入口；名称中的「透明捕获」不代表任意代理模式都有相同协议能力。

macOS 的系统代理按网络服务配置，提供 HTTP、HTTPS、PAC 和绕过列表；这是一项网络设置，不是所有程序遵循它的保证。[Apple 代理设置][mac-proxy] Windows 也须区分应用网络栈：WinHTTP 可按会话或请求选择代理，使用 WinINet 配置需要客户端相应处理，不能把一个设置面板视为全机覆盖证明。[Microsoft WinHTTP][win-proxy]

Local Capture 的平台集成已经有成熟实现：macOS 使用 Network Extension，Windows 使用基于 WinDivert 的重定向组件。[当前项目结构][rust-structure] Windows 的重定向进程需要权限；macOS 的系统扩展涉及签名和公证。这些成本不会因选择按域名过滤而消失。[Windows 实现][win-local]、[macOS 实现][mac-local]

## 3. 系统信任并不覆盖所有客户端

- **系统证书库：** macOS 可在 Keychain Access 调整证书信任；Windows 区分当前用户和本机证书库，作用域不同。须核对实际运行账号和使用的证书库。[Apple 信任设置][mac-ca]、[Microsoft 证书库][win-ca]
- **独立信任库：** Node.js 默认使用随运行时附带的 Mozilla 根证书，不自动查询系统证书库。支持的版本可启用系统 CA；实际客户端内置的运行时版本、启动方式和网络库仍须核对。[Node.js 企业网络配置][node-network]
- **显式覆盖：** `NODE_EXTRA_CA_CERTS` 只在 Node.js 进程启动时读取；客户端显式指定 `ca` 时，默认和额外 CA 不会按通常方式生效。不能把导入系统 CA 或改一个环境变量视为必然完成。[Node.js CLI][node-cli]
- **证书固定：** 使用 certificate pinning 的应用可能拒绝本地 CA 签发证书。对未修改的官方客户端，这是阻塞条件；本路线不以修改客户端、关闭 TLS 校验或强行绕过固定证书作为前提。[mitmproxy 证书说明][certs]
- **双向 TLS：** 若服务要求 mTLS，代理与上游还涉及客户端证书身份。不能假定原客户端与代理的两段连接会自动继承同一身份。[mitmproxy mTLS][certs]

## 4. 域名筛选不能替代正文协议适配

`allow_hosts` 可以只对选定主机执行拦截；`ignore_hosts` 将匹配连接原样转发。它们不是内容脱敏规则，也不是「未匹配就禁止联网」的防火墙。HTTPS 解密前的匹配主要依赖 CONNECT 目标、IP 或可见 SNI，此时不能依赖加密的 HTTP 路径与正文。[域名筛选][domains]

**工程建议：** 按「选定应用进程 + 明确目标主机 + 经验证的路径和内容类型」逐层缩小范围。一个 AI 主域名可能承载多类请求，任务也可能访问其他上传或辅助服务；域名表应由受控实验核对，不能凭品牌名称宣称完整覆盖。

| 协议 | 官方能力与已知限制 | 验收重点 |
| --- | --- | --- |
| HTTP/2 | 支持；忽略 PRIORITY，不提供 Push Promises，不支持 h2c | 并发、取消、错误与真实客户端行为 |
| HTTP/3 | 仅 reverse、local、WireGuard；当前仅 QUIC v1；Client Replay 有问题，主要充分测试对象为 cURL | 不能假定普通 CONNECT 或所有 QUIC 客户端兼容，也不能假定自动回退 |
| WebSocket | 支持消息压缩；不支持客户端或服务端回放，未知扩展可能出现不兼容 | 双向消息、分片、工具会话、断线续接 |

协议范围来自 [mitmproxy Protocols][protocols]；传输层支持并不等于对应 AI 应用协议已适配。

mitmproxy 默认完整缓冲请求和响应；普通流式转发启用后，常规正文替换不再作用于这些流式正文。[Streaming 与正文修改][features] **工程要求：** 需要过滤的请求必须在敏感内容外发前完成相应检查；不能先把未检查的请求流发出，再在结束时判定。SSE 响应的实时返回、取消及需要恢复的代号应另行设计和验证。

gRPC 也不能当作普通 JSON 处理：官方协议定义了压缩标志、长度前缀消息和 trailers，HTTP/2 DATA 边界不等于消息边界。[gRPC 协议][grpc] AI 协议还有工具、缓存、会话与 thinking 等约束；Claude Code 官方兼容指南就是实际例子。[Claude Code 协议][claude-protocol]

**条件性阻塞：** 若待修改内容受额外签名保护，修改可能使签名校验失败；若正文另行应用层加密，仅终止 TLS 仍得不到内部明文。这是通用协议边界，**没有证据表明 WorkBuddy 采用了这些机制**。[RFC 9421][signatures]、[RFC 7516][jwe]

**覆盖边界：** 本机代理只能处理实际经过本机的流量。若最终上下文拼装、工具执行或后续模型调用发生在云端，本机捕获不能证明那些内部调用全部经过检查。此项是工程推断，不是对任何具体客户端架构的断言。

## 5. 工具许可与产品维护

mitmproxy 主项目采用 MIT 许可，允许使用、修改和分发，需保留相应版权及许可声明。[MIT 许可][license] 当前 Windows 捕获组件使用 WinDivert；其官方 FAQ 列明闭源使用需要遵循 LGPL v3，或取得另行商业许可。因此不能把包含驱动的整包简单标成「全部 MIT」。应按实际分发组件核对，而不是只看代理主项目许可证。[项目结构][rust-structure]、[WinDivert FAQ][windivert]

若将 macOS 系统扩展重新打包到自有产品，Apple 对 Team ID、扩展标识、公证或商店分发有明确要求；复用成熟代理不会取消这些分发条件。[Apple System Extensions][mac-extension]

**工程建议：** 每机独立 CA 和私钥，限制私钥访问；默认不持久保存明文正文、Cookie 与 Authorization；仅启用授权目标，保持上游证书校验。安装、升级和卸载应能恢复原代理设置并移除本产品信任项。mitmproxy 本身为不同安装生成不同 CA，但产品仍要管理其生命周期。[CA 管理][certs]

原生订阅和第三方产品许可继续按 [原生订阅研究](NATIVE-SUBSCRIPTION-RESEARCH.md) 分平台核验。工具开源许可不能代替平台对具体登录、订阅和产品形态的许可；本研究不作「免封」承诺。

## 6. 本项目现状与最小验证顺序

本轮源码检查确认：[现有服务](../src/gateway/server.ts)仍是 HTTP API 入口，限定未压缩 JSON 和 256 KiB 请求；[协议处理](../src/gateway/protocol.ts)采用严格文本白名单，不能直接承接完整工具协议。新增成熟代理入口后，可以研究复用 [隐私流水线](../src/privacy/pipeline.ts)，但需要独立的请求识别和编码适配，不能仅安装 CA 就宣称现有服务具备 HTTPS 解密。

[2026-09-11 的 WorkBuddy 记录](WORKBUDDY-VALIDATION.md)只证明本机 5.5.2、Free / Auto 在显式 CONNECT 代理启用时完成过原登录调用，并观察到 `www.workbuddy.ai` 连接。记录未解密，不能据此确认模型正文路径、全部流量、付费权益或工具任务。本轮未复测该历史实验。

以下是候选实验，不是本次已实施事项：

1. **先证明受信解密与原调用。** 固定客户端和代理版本，在授权的测试进程、明确目标范围内，保留本人官方登录，只发合成内容。验证 TLS 正常、可以识别模型请求、原调用仍完成；同时核对有无绕过代理的请求。
2. **再证明单字段替换。** 使用可识别的合成标记，只改一个已确认的文本字段，验证替换后的请求在外发前已生成，原服务实际接受。不得仅凭模型回显认定过滤完整；阻断测试须证明没有模型请求外发。
3. **最后验证完整任务。** 覆盖文件上下文、工具结果、多轮、流式响应、取消、重试和恢复，再核对原模型及原额度；Windows/macOS 分别验收。遇到证书固定、未知加密、签名失败或未覆盖请求，保留「未支持」状态，不静默改用直连或独立 API。

[mechanism]: https://docs.mitmproxy.org/stable/concepts/how-mitmproxy-works/
[modes]: https://docs.mitmproxy.org/stable/concepts/modes/
[certs]: https://docs.mitmproxy.org/stable/concepts/certificates/
[domains]: https://docs.mitmproxy.org/stable/howto/ignore-domains/
[protocols]: https://docs.mitmproxy.org/stable/concepts/protocols/
[features]: https://docs.mitmproxy.org/stable/overview/features/#streaming
[rust-structure]: https://github.com/mitmproxy/mitmproxy_rs#structure
[win-local]: https://www.mitmproxy.org/posts/local-capture/windows/
[mac-local]: https://www.mitmproxy.org/posts/local-capture/macos/
[mac-proxy]: https://support.apple.com/en-gb/guide/mac-help/mchlp2591/mac
[mac-ca]: https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac
[win-proxy]: https://learn.microsoft.com/en-us/windows/win32/winhttp/setting-wininet-proxy-configurations-in-winhttp
[win-ca]: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/local-machine-and-current-user-certificate-stores
[node-network]: https://nodejs.org/learn/http/enterprise-network-configuration
[node-cli]: https://nodejs.org/api/cli.html#node_extra_ca_certsfile
[grpc]: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
[claude-protocol]: https://code.claude.com/docs/en/llm-gateway-protocol
[signatures]: https://www.rfc-editor.org/rfc/rfc9421.html#section-7.4.1
[jwe]: https://www.rfc-editor.org/rfc/rfc7516.html#section-1
[license]: https://github.com/mitmproxy/mitmproxy/blob/main/LICENSE
[windivert]: https://reqrypt.org/windivert-faq.html
[mac-extension]: https://developer.apple.com/documentation/systemextensions
