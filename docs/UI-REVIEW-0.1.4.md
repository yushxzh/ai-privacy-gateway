## verdict

1. **resolved — 停止网关后的恢复直连。** 最新 `docs/assets/workbuddy-stopped.png` 中，顶部明确显示「网关已停止」，已接入 DeepSeek 的「恢复直连」保持可用，另两条未接入模型的「启用过滤」呈禁用态；`src/renderer/src/App.tsx:825` 已改为 `(!model.connected && !snapshot.running)`，恢复动作不再依赖网关运行。最新 `workbuddy-models.png` 中网关运行时，未接入模型的启用按钮恢复正常状态。
2. **resolved — 旧配置迁移的连接状态文字。** 上述两张最新截图中，未接入模型均显示「尚未启用过滤」；`src/renderer/src/App.tsx:824` 对所有 `connected=false` 使用该文案，不再从未接入状态推断已直连原服务，因此覆盖原发现中的旧 0.1.3 本地入口迁移状态。

## remaining

clear。两条原 finding 均已解决，未见本批修复引入的视觉回归。本次只核对原问题及最新截图、对应源码；未扩大审查范围或重跑检测器。主代理另报告停止状态恢复、配置还原与重启再启用的 Electron 回归通过，该测试结果与本次截图复核分别记录。

disposition: ship
