# GPT / Computer use / Blender 二次适配调研

日期：2026-09-24。鲲鹏基线：4ec9cda（v2.9.44）。本次仅调研与记录，没有修改产品代码、调用付费模型、操控桌面或执行 Blender。

## 结论

现有 Responses、工具图片回传、加密推理状态保留是必要基础，但不能据此认为桌面控制和 Blender 已完整接通。最优先工作是接通执行后端、建立截图与动作的校验闭环、补足 Blender 可编辑工程交付；继续加提示词的收益有限。

此次检查的 Codex 公共代码提供通用执行、图片、上下文和调度机制，不能等同于 Codex 桌面产品的全部能力，也未确认其中存在可直接搬入的专用 Blender 建模模块。DMX 模型别名可用不代表它透传全部 OpenAI 原生工具协议。

## 已有基础应保留

- GPT 独立 Provider；Responses 工具调用只在完整响应校验后执行，避免执行半截参数。
- 图片输入 original detail、完整 MCP 参数 schema 和图片结果；同模型同端点匹配后重放 Responses 状态。
- 专用浏览器已有 DOM snapshot/ref 操作；优先用它处理网页，比盲点坐标可靠。
- 已有白模运镜技能、结构化场景 spec、快速预览和渲染日志；不应误删或用通用建模替代。
- Bash 已支持取消和已完成输出分页；缺口是长任务运行期间的会话化查询，而非完全不能执行 Blender。

## 已确认的缺口与建议

| 优先级 | 本地代码证据 | 建议与收益 | 影响边界 |
|---|---|---|---|
| P0 | `src/lib/agent/mcp/servers.ts` 服务列表为空；`src/hooks/useAgent.ts:1116` 加载外部 MCP 仍依赖 GLM Key | 服务初始化与语言供应商解耦；本地无认证服务无需 API Key，远端按服务配置认证。不可把 DMX Key 自动发给本地或其他 MCP 服务 | 涉及外部 MCP 注册入口；与 DSH 对外暴露鲲鹏工具的桥接不是同一路径 |
| P0 | `src-tauri/src/mcp_stdio.rs` 只有一个进程槽，新服务会杀旧服务；返回首个可解析 JSON 而非按 request id 匹配 | 按 server/session 隔离进程和待处理请求，区分通知/响应，正确传播取消；否则桌面与 Blender 两个 stdio 服务无法可靠共存 | 共享基础设施，必须隔离上线并做三供应商回归 |
| P0 | `src/lib/agent/mcp/httpTransport.ts` 遇 -32600 自动重连并重发任意请求 | 不把一般错误直接当会话过期；有副作用的 tools/call 状态不明时禁止自动重放，先查操作状态 | 静态发现重放风险，未证明发生过用户现场重复操作 |
| P0 | `src/lib/agent/tools/browserTool.ts:118` 截图只回文件路径，提示继续调用 vision | GPT 路径直接返回图片和必要状态，省一次额外识图；不修改 DeepSeek/Kimi 当前视觉路由 | 可从 GPT 工具包装层开始 |
| P1 | 现有媒体结构未建立屏幕尺寸、缩放、窗口身份与截图关联的动作契约 | 桌面观察返回 screenshotId、时间、窗口、像素/逻辑尺寸；动作引用观察版本，状态改变后重新观察；执行后回图验证 | 新后台工具能力，沿用现有对话，不新增按钮 |
| P1 | 本机 `~/.kunpeng/skills/blender-clay-previz` 是白模运镜；`clay_render.py` 无保存 `.blend` 的调用 | 通用建模另设明确技能路由：读场景→按稳定对象 ID 修改→预览检查→保存 `.blend`→重新打开验证。保留白模路径 | 先 GPT 技能/工具包装，不替换共享 loop |
| P1 | `bashTool.ts` 等待命令结束；现有 backgroundTask 不是通用渲染任务服务 | 渲染返回 jobId，支持增量日志、状态、取消和恢复查询。超时后查旧任务，不重复启动渲染 | 执行服务有共享影响；先独立工具实现 |
| P2 | `gptResponses.ts:74` 对所有工具固定关闭并行 | 只允许明确只读且独立的查询并行；同一桌面/Blender 场景写操作串行，用资源锁控制 | 不应直接全局开启 parallel_tool_calls |
| P2 | `contextManager.ts` 图片统一估 1800 token，并把 Responses JSON 与已有文本/调用共同计数 | GPT 专属估算避免重复统计；按尺寸/细节估算截图成本，保留最新观察及关键历史，避免过早压缩或图片超预算 | 修改上下文层需保持其他供应商现有分支 |

## 对照 Codex 的可借鉴机制

以下源文件以公共仓库快照 `f5f08c54cb7a774594d3579c5731ea3e87f01c48` 为准，通过 GitHub blob API 读取。

1. [tools/parallel.rs](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/tools/parallel.rs)：按工具是否支持并行选择读锁/写锁，并贯穿取消和调用生命周期。可借鉴能力分类，而不是一次放开所有工具。
2. [view_image.rs](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/tools/handlers/view_image.rs)：检查文件及图片解码，使用结构化图片引用，历史层负责图片准备。鲲鹏可统一截图入口，避免路径文本与图片内容混淆。
3. [unified_exec/exec_command.rs](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs)：执行管理器支持可继续读取的进程状态；适合借鉴到长时间 Blender 渲染，不必让一次工具调用一直等待。
4. [context_manager/history.rs](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/context_manager/history.rs)：区分模型可见内容、加密状态、original 图片的估算，并维护调用/结果完整性。其估算常量不应直接视为 DMX 模型真实计费参数。

[OpenAI computer use 接入文档](https://developers.openai.com/api/docs/guides/tools-computer-use-integration)展示原生 computer 与自定义执行服务接入；要求动作完成后回传观察。original 截图也有尺寸限制，缩图后必须映射坐标。因此建议先采用已验证的 function 工具协议，再单独验证 DMX 是否支持原生 computer_call，不直接替换当前 Responses 解码器。

## Blender 后台工作流建议

- 区分白模运镜、通用建模、材质灯光、已有工程修改，防止用户提到 Blender 就进入白模模式。
- 先读取版本、对象、集合、单位、活动场景、渲染器，再执行修改；不能仅靠生成一段 bpy 代码猜环境。
- 操作使用稳定名称或对象标识，重复执行更新已有对象；修改前保存检查点，失败后有明确恢复点。
- 优先使用适合数据操作的接口；需要操作符时校验模式、活动对象与上下文。无界面运行和交互界面行为需分别测试。
- 质量检查覆盖几何尺寸、可见性、相机、材质引用和预览图；最终工程保存后重新打开，核实对象及外部资源。脚本返回成功不等于模型满足需求。
- 以上均为后台判断与验证，不新增 UI 按钮，不新增用户不需要的首尾帧制作功能。

## 兼容性与验证边界

不能在改动前保证共享 MCP 重构对 DeepSeek/Kimi 零影响。建议先做 GPT 专属截图返回、技能路由和工具包装；旧 transport 保留默认行为，新实现按服务显式启用。DSH runtime、Kimi/DeepSeek Provider、共享对话 loop 不在首批改动范围内。

后续验收应包括：

- GPT 两个模型分别完成真实截图→操作→复查，覆盖 Retina 缩放、窗口变化、过期截图、取消及断连；合成色块识图测试不能代替此项。
- 两个 MCP 服务同时运行，交错请求、通知、初始化、退出均正确；取消一个不结束另一个。
- Blender 新建、修改、渲染、保存重开；长任务超时恢复不重复执行；白模运镜原流程回归。
- DeepSeek、Kimi 与 DSH 分别回归文本/图片/工具结果、询问选项、取消与续聊；修改共享设施后执行实际端到端冒烟。
- 分开记录模型首字等待、工具执行、截图编码/传输、渲染和界面刷新耗时。当前调研不能把所有卡顿归因于模型或 MCP；需测量后确认收益。

建议实施顺序：GPT 原生截图闭环 → MCP 服务隔离与可靠性 → Blender 通用建模和工程验证 → 长任务会话化 → 有限并行与上下文预算。所有优化沿用现有界面。
