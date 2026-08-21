# DeepSeek Harness 迁移报告

## 结论

鲲鹏主 Agent 的 DeepSeek 路由已迁移到 DeepSeek 官方 Harness，版本锁定为 `@deepseek-ai/dsh@0.1.0-rc.6`。DeepSeek 默认使用 Harness，设置中可切回迁移前的内置执行链。Kimi、GLM 与 `quickChatDirectDeepseek` 旁路未改为 DSH。

实现采用 ACP + MCP 双桥：

- ACP 负责 DeepSeek 会话、流式文本、终止和状态事件。
- MCP 把鲲鹏现有 `ToolRegistry` 暴露为 `mcp__kunpeng__*`，工具仍由鲲鹏进程内执行，因此保留 activeView 门控、风险分级和确认弹窗。
- DSH 子进程只从环境变量读取 `DEEPSEEK_API_KEY`，关闭遥测，并继承系统代理环境变量。

## 本轮修复（kunpeng.3 → kunpeng.4）

### 根因：桌面端 `session/new` 报 "the ACP bridge has been disposed"

dsh-app-boot 的 `boot()` 以**配置文件所在目录**为 `ctx.baseUrl` 解析裸包名（`packages/llm` 等）。此前 `dsh.rs` 把运行配置写到 `~/.kunpeng/dsh/runs/<id>/cordis.yml`（运行时根之外），裸包名 `@deepseek-ai/dsh-llm-deepseek` 从该目录无法解析到 `~/.kunpeng/dsh/0.1.0-rc.6/node_modules`：boot 抛出 "plugin tree failed to load" 并 dispose 半挂载树——此时 ACP host（绝对路径引用，挂载成功）已应答 initialize，随后的 session/new 撞上 `closed=true`，即 "the ACP bridge has been disposed"。

**修复**：`dsh.rs` 生成的配置中，`llm-deepseek` 条目改用绝对入口路径 `<runtime>/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`（与 ACP host 同一模式），并加入启动前文件存在性校验。官方基线脚本 `dsh-runtime/tests/acp-baseline-smoke.mjs` 的工作目录也一并移入运行时根内（同样的解析基址问题）。

验证：`dsh-runtime/tests/acp-host-smoke.mjs`（新增）按桌面端完全相同的配置做 Node 级复现——配置在运行时根之外时必现 boot 失败；改绝对路径后 initialize → session/new → session/prompt 全通过，含真实 MCP 工具调用（33 个观察事件）。

### MCP 子进程遗留修复

`kunpeng-mcp-server.mjs` 增加自杀守卫：stdin EOF（DSH 父进程死亡）或工具桥 socket 关闭时立即退出。实测 stdin EOF 后 1.5s 内退出，不留孤儿进程。

### 其他

- `DSH_RUNTIME_REVISION` 升至 `0.1.0-rc.6-kunpeng.4`，触发已部署运行时的自动重部署（已在真机上验证重部署发生）。

## 主要改动

### DSH 运行时

- `dsh-runtime/package.json`
- `dsh-runtime/package-lock.json`
- `dsh-runtime/kunpeng-acp-host.mjs`
- `dsh-runtime/kunpeng-mcp-server.mjs`
- `dsh-runtime/node/bin/node`
- `dsh-runtime/node_modules/`

所有 DSH 运行时包都精确锁定为 `0.1.0-rc.6`；其 schema 依赖 `@deepseek-ai/schemastery` 固定为 `3.18.1`。运行时内置 Node 24，避免系统 Node 26 与 `koffi` 的兼容问题。当前预置运行时约 466 MB。

### Tauri 双桥

- `src-tauri/src/dsh.rs`
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`

新增 DSH 运行时原子解压、ACP stdio 生命周期、MCP 工具 RPC、事件转发、停止与应用退出清理。运行时修订号为 `0.1.0-rc.6-kunpeng.4`，同一 DSH 版本下的 host 修订也能触发重新部署。

敏感信息处理：

- API key 仅通过子进程环境变量传递。
- `DSH_TELEMETRY_MODE=DISABLED`。
- `NODE_USE_ENV_PROXY=1`，并透传 `HTTP_PROXY`、`HTTPS_PROXY` 及对应小写变量。
- stderr 在进入 WebView 前进行密钥与认证信息脱敏。
- 私有 Harness 观察事件使用独立前缀，不混入普通诊断日志。

### 前端桥与路由

- `src/lib/agent/dsh/DshBridge.ts`
- `src/lib/agent/dsh/acpClient.ts`
- `src/lib/agent/dsh/streamUpdate.ts`
- `src/lib/agent/dsh/toolBridge.ts`
- `src/lib/agent/dsh/toolRpc.ts`
- `src/lib/agent/dsh/routing.ts`
- `src/lib/agent/dsh/types.ts`
- `src/hooks/useAgent.ts`
- `src/lib/agent/coordinator.ts`
- `src/lib/agent/types.ts`

分流条件只在主路由为 DeepSeek 且设置不是 `builtin` 时成立。DSH 失败后沿用原有 fallback 链继续交给内置 coordinator，GLM/Kimi 的原执行链不经过 DSH。

鲲鹏原有上下文能力继续注入：system prompt、工作区规则、技能提示、记忆召回、时间锚点和有限历史消息。Harness 路由的上下文窗口按 1M 配置，前端上下文胶囊接收 DSH 用量事件。

### 设置与持久化

- `src/components/settings/ProviderSettings.tsx`
- `src/stores/settingsStore.ts`

DeepSeek 卡片新增：

- `Harness`：默认，使用官方 DSH。
- `内置（回退）`：恢复迁移前的自研 loop。

设置存储升级到 v27，旧设置自动补默认值，不改动现有 key、base URL 和模型配置。

## 官方 DSH 组件

自定义 ACP host 在同一个 Cordis context 中挂载以下官方组件，没有修改 DSH 源码：

- Agent spine
- DeepSeek LLM provider
- MCP client
- ACP server
- Session projection
- Token meter
- Tool result pruner
- Basic compaction engine

Basic compaction 与工具结果裁剪使用官方插件；鲲鹏只监听其事件并转成 UI 可读进度。

## 事件样本

Phase 0 和最终 host 均使用真实 DeepSeek API 做过探针。敏感字段已省略。

```json
{"protocolVersion":1,"session":"new","stopReason":"end_turn"}
{"type":"agent_thought_chunk","content":"..."}
{"type":"tool_call","name":"mcp__kunpeng__probe","status":"completed"}
{"type":"usage_update","inputTokens":"<measured>","outputTokens":"<measured>"}
```

探针最终回复包含 MCP 返回的不可预测值：

```text
DSH_ACP_OK KUNPENG_TOOL_OK:rc6:<uuid>
```

一次完整探针观测到 45 个 reasoning 事件、2 个 usage 事件和 1 个 tool 事件。官方 rc.6 ACP 只负责最终文本流；思考、用量、工具进度由同一 DSH context 内的只读 observer 转发，未复制或替代官方 agent loop。

## 验证结果

### 构建与静态检查

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `cargo check` | 通过，只有项目既有 warning |
| `npm run build` | 通过，只有既有 chunk warning |
| `npm run tauri:build` | 通过 |

构建后的 DMG 已只读挂载核验，包内 Node、ACP host、MCP server 均存在，包内 `@deepseek-ai/dsh` 实际版本为 `0.1.0-rc.6`。

生产构建产物位于项目标准目录：

`src-tauri/target/release/bundle/dmg/鲲鹏_2.8.2_aarch64.dmg`

未复制到桌面，未安装应用。

### 自动化测试

| 测试 | 结果 |
| --- | --- |
| `npm run test:harness` | 53/53 |
| `npm run test:context` | 10/10 |
| `npm run test:usability` | 5/5 |
| `npm run test:omni` | 6/6 |
| `npm run test:omni-refs` | 2/2 |
| `npm run test:storyboard-refs` | 19/19 |
| `npm run test:video-prompt` | 4/4 |
| `npm run test:image-size` | 3/3 |
| `npm run test:midjourney` | 4/4 |
| Seedance + canvas reference policy | 9/9 |

DSH 专项覆盖包含：ACP 流式解析、Harness 观察事件、MCP RPC 往返、工具确认、abort 后配对修补、compaction 展示和失败后 fallback 到原有 GLM 路径。另有 `dsh-runtime/tests/acp-baseline-smoke.mjs`（官方 dsh-acp-demo 基线）与 `dsh-runtime/tests/acp-host-smoke.mjs`（自定义 host 全组合 + MCP 端到端，支持 `SMOKE_WORK_DIR` 复现桌面配置目录）两个真实 API 冒烟脚本，均通过。

### 真实 API 探针

- 官方 DSH + DeepSeek `deepseek-v4-flash`：通过。
- ACP new session：通过。
- MCP 挂载及工具调用：通过。
- reasoning、usage、tool 观察事件：通过。
- key 未写入配置文件、日志或报告。

### 桌面 UI 冒烟（kunpeng.4 真机验证，2026-08-16）

在 debug 包上逐项完成真实桌面冒烟：

| 项 | 结果 | 证据 |
| --- | --- | --- |
| DeepSeek 普通对话 | 通过 | 发送 "Reply with exactly: DSH SMOKE OK" 得到精确回复；DSH session jsonl 记录完整 turn（含鲲鹏记忆注入的 user/message 与 reasoning-chunks） |
| DeepSeek 画布工具调用 | 通过 | `mcp__kunpeng__canvas_add_node` 真实调用并返回 `{"id":"node-gs0-us7b","type":"text",...}`，节点落到画布 |
| DeepSeek 工坊工具调用 | 通过 | `mcp__kunpeng__workshop_get_state` 调用成功，回复 WORKSHOP-DSH-OK |
| reasoning 流式展示 | 通过 | 长任务中途截图确认 "思考中..." 指示与 reasoning 内容实时滚动 |
| 工具确认弹窗 | 通过 | 手动确认模式下 bash `export PATH=...` 触发确认弹窗（鲲鹏想要执行命令/修改关键环境变量），点击"允许"后执行成功；`echo` 类安全命令按既有分级不弹窗，与内置链路行为一致 |
| 中止任务 | 通过 | 流式中途点击停止按钮，UI 干净收尾，无残留状态，无 DSH/MCP 孤儿进程 |
| 会话恢复 | 通过 | 切换到其他会话再返回，历史完整恢复，上下文胶囊读数恢复 |
| Kimi 回归 | 通过 | 切到 Kimi K3 发送消息得到正确回复，走原有 coordinator |
| GLM 回归 | 未测 | 当前环境未配置 GLM API Key（模型选择器显示"未配置"），无法真机验证；GLM 代码路径本轮零改动 |

桌面冒烟期间确认：运行时按修订号自动重部署（`.ready` = kunpeng.4），上下文用量胶囊随 DSH usage 事件增长（3% → 4% → 5%）。

## 已知限制

1. DSH rc.6 ACP demo 支持新建会话，不支持 resume/list/fork。鲲鹏目前每次运行新建 ACP session，并注入受控历史上下文。
2. `queueGuidance` 在 rc.6 下不能真正插入当前 turn，只能排队，在当前 ACP prompt 结束后发送。
3. ACP initialize 声明原生图片输入不可用。路径和 resource link 可作为文本上下文，MCP 工具仍可在 DSH 内返回多模态结果；主聊天直接附图的原生 ACP 输入需要等待上游支持或后续增加独立媒体桥。
4. 预置 Node + DSH 依赖使安装包明显增大，当前运行时约 466 MB。
5. DSH 进程在正常完成、abort、任务切换和应用退出时清理；kunpeng-mcp-server 在 stdin EOF 或工具桥断开时自行退出（kunpeng.4 起），异常崩溃后不再遗留 MCP 孤儿进程。

## 回退

用户可在设置的 DeepSeek 卡片中切到 `内置（回退）`。该开关只影响主 Agent 的 DeepSeek 路由，不影响 Kimi、GLM 和 `quickChatDirectDeepseek`。
