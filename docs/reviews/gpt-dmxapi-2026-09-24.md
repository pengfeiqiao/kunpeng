# GPT / DMXAPI 接入与旧引擎兼容性

## 配置与模型

- 语言模型增加 GPT 分组：`gpt-6-luna`（GPT6 Luna · 便宜）、`gpt-6-sol-cdx`（GPT6 Sol · 贵）。Sol 保留 DMXAPI 的精确转发名称。
- GPT 默认请求地址 `https://www.dmxapi.cn/v1`，使用 Responses API。已有 GPT 独立凭证优先；否则动态复用 DMXAPI 凭证、旧 DMX Key 或 DMX 图片槽位凭证。没有复制 Key，轮换后自动生效。
- 自定义 GPT 地址改到其他域名时停止自动复用 DMX Key，防止密钥发错服务。用户原本选择的 DeepSeek/Kimi 和引擎设置不变。

## 协议与创作工具

新增独立 GPT provider，保留已有 DeepSeek/Kimi provider 与 DSH 运行时。支持 Responses SSE、完整工具调用和结果配对、原生图片、加密 reasoning 上下文、message phase、取消与断流清理。只在完整完成事件后释放可执行工具调用；断流/不完整参数不会被当作成功，不自动重放请求。GPT 的 opaque 输出仅回传原模型和原地址，并计入上下文预算。

GPT 专属工具指引强调最近截图、少量动作后验证，以及 Blender 场景检查、bpy/MCP 执行、渲染目检和保存验证。通过鲲鹏已有工具与 MCP 工作，不依赖中转站托管的 computer 工具；不自动安装新的桌面控制或 Blender 服务。

共享 MCP 层修复两处信息丢失：保留完整 JSON Schema（嵌套参数、数组、nullable、数值枚举），将 PNG/JPEG/WebP/GIF 返回到既有 ToolResult.media。其他图片格式继续保留文字结果，避免旧模型收到不支持的输入。原有工具名称、参数转发、文本结果、确认/风险与执行路径均保留。

## 验证

- DMXAPI `/v1/models` 实查包含两个精确模型 ID。
- 两个模型均通过真实 Responses 冒烟：调用无副作用的测试工具，返回本地构造的红底蓝方块图片，再由模型正确识别两种颜色。没有上传用户截图或项目文件，没有触发生图、视频、配音或真实桌面操作。
- Sol 首次 55 秒请求超时；第二次在更长的验证超时内完成两轮。不能据此保证中转站所有请求的延迟或可用性。
- MCP 专项回归覆盖 DeepSeek/Kimi 原有 Anthropic 消息转换、thinking 签名和 tool result 配对；DSH 实际工具 RPC/结果序列化、6 MiB 内联保护、执行前副作用标记和取消。
- 原有 harness 全量、DSH runtime 生命周期、上下文压缩测试与生产构建通过。没有对实际桌面或 Blender 应用做端到端操控，也没有在这次变更中发起 DeepSeek/Kimi 的真实付费模型调用。
- 源码与前端构建完成；尚未打包安装或发布。

## 参考

- [DMXAPI Responses 文档](https://doc.dmxapi.cn/OpenAI_request_Text.html)
- [GPT-6 Luna 模型协议](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Responses reasoning 的无状态保留](https://developers.openai.com/api/docs/guides/reasoning)
- [Codex Responses SSE](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/codex-api/src/sse/responses.rs)
- [Codex 输入/工具结果数据模型](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/protocol/src/models.rs)
