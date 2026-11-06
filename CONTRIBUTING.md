# 参与贡献

欢迎提交 Bug、设备适配反馈、文档改进和 Pull Request。

## 本地开发

使用 Node.js 20 或更高版本。本仓库当前无 npm 包依赖：

```bash
npm run check
```

- 配置源：`config/gateway.config.js`，内容会嵌入 Gateway config Function。
- flow 源：`scripts/build-flow.mjs`，输出 `flows/ha-mqtt-bridge.json`。
- 核心映射：`src/gateway-core.mjs`。
- README 图片：`docs/assets/`；流程图与版本徽章由 `npm run build:assets` 生成。
- 回归测试：`scripts/run-tests.mjs` 和 `tests/`。

修改协议时同步更新核心模块与 flow 生成器，并为实际导出 Function 增加行为测试。提交生成的 JSON，确保再次构建没有未提交变化。

## 问题反馈

请附 Node-RED、HA、WebSocket 节点包和 Broker 版本，最小复现步骤、预期与实际结果，以及脱敏后的错误信息。不要附账号密码、访问令牌、完整现场 flow、真实设备目录或状态快照。

若需说明设备差异，使用虚构 ID 和最少必要属性。避免在 issue 中直接贴未经检查的日志和截图。

## 发布前检查

`npm run check:release` 检查本地路径、IP、常见凭据与敏感文件，并检查公开默认配置、Markdown/HTML 图片链接及 SVG 的外部引用和活动内容。此扫描是辅助检查，不能发现所有自定义敏感字段；发布前仍需阅读 diff。

从独立仓库提交本项目，不要把包含现场数据的旧仓库历史一起复制。确认许可证、文档、测试与导出 flow 一致后，再创建版本标签。

贡献代码遵循仓库的 Apache-2.0 许可证。外部依赖保持其自身许可证，不在本仓库重新授权。
