# 鲲鹏 CLI

鲲鹏 CLI 是本机控制入口。Codex、Kimi Code、Grok Bot 以及其他能执行 shell 命令的 Agent，都可以通过它把任务交给正在运行的鲲鹏，并复用鲲鹏已有的模型路由、技能、MCP 工具、项目数据和产物目录。

## 安装与状态

新版鲲鹏启动后会自动安装/更新 CLI。也可在源码目录手动执行：

```bash
node cli/kunpeng.mjs install
kunpeng status
```

默认安装到 `~/.local/bin/kunpeng`；Windows 安装到 `~/.kunpeng/bin/kunpeng.cmd`。如果终端找不到命令，请把对应目录加入 PATH。

本机 CLI 只连接 `127.0.0.1`。鲲鹏每次启动会生成新的随机端口和令牌，写入仅当前用户可读的 `~/.kunpeng/cli.json`。不要把该文件发给他人，也不要把令牌写进日志、命令参数或提示词。

## 远程队列（云电脑 / 共享目录）

云电脑不需要 `cli.json`、本机端口或供应商密钥。让云电脑与运行鲲鹏的电脑共享同一个任务目录（共享磁盘、同步目录或受控文件同步均可），然后给原命令添加 `--queue`：

```bash
# 云端查看本机执行桥是否在线
kunpeng status --queue /shared/kunpeng-queue --json

# 云端投递 Agent 任务并等待本机结果
kunpeng task "整理当前项目" --session cloud-film --queue /shared/kunpeng-queue --json

# 云端直接调用本机生图/生视频渠道
kunpeng image "雨夜老街，电影感" --queue /shared/kunpeng-queue --json
kunpeng video "镜头缓慢推进" --queue /shared/kunpeng-queue --json

# 画布与工坊同样使用队列
kunpeng canvas "生成画面" --node <节点ID> --model gpt-image-2.5 --queue /shared/kunpeng-queue --json
kunpeng workshop --kind image --targets 01-01 --queue /shared/kunpeng-queue --json

# 停止任务
kunpeng cancel <requestId> --queue /shared/kunpeng-queue
```

云端也可用 `KUNPENG_QUEUE_DIR=/shared/kunpeng-queue` 代替每次传 `--queue`。本机默认消费 `~/.kunpeng/queue/`，启动鲲鹏前设置同名环境变量可改用其他根目录：

```bash
KUNPENG_QUEUE_DIR=/shared/kunpeng-queue /Applications/鲲鹏.app/Contents/MacOS/鲲鹏
```

云端队列目录必须与本机队列根目录指向同一共享内容。目录结构为 `inbox/`（新任务）、`processing/`（执行中）、`results/`（结果与进度）、`cancel/`（停止请求）和 `status.json`（心跳，每 3 秒一次，避免高频刷同步盘）。

- 投递使用临时文件原子发布，鲲鹏先把任务移入 `processing/` 再执行，避免重复消费。
- 断网时任务可以留在队列，心跳恢复后消费；`--stream-json` 可读取本机写入的进度事件。
- 如果鲲鹏在执行中退出，恢复时只标记“结果未知”，**不会自动重放任务或付费生成**。
- 生成结果的 `data.artifactAccess` 为 `local_only`：成品文件仍在本机，云端只接收元数据，本机绝对路径不可直接访问；不会把本地路径伪装成可下载 URL。
- 当前远程方案是文件队列，不开放公网端口，也未启用隧道。共享目录本身必须配置正确的访问权限；不要把供应商密钥、`cli.json` 或整个 `.kunpeng` 目录同步到云端。

## 1. 交给鲲鹏 Agent 执行任务

```bash
kunpeng task "读取当前项目，整理今天的生成结果"
kunpeng task "继续完善上一个方案" --session film-01
kunpeng task "调用工具完成这个修改" --always-approve --max-turns 30
```

- 默认只执行无需额外确认的工具；需要确认的工具会被拒绝并说明原因。
- `--always-approve` 允许自动执行需要确认的工具，包括可能收费的生图、生视频和配音。只有用户明确授权时才使用。
- 同名 `--session` 在鲲鹏本次运行期间保留多轮上下文；不同会话可以并行。
- 默认输出最终文本；`--json` 输出机器可读结果，`--stream-json` 输出 NDJSON 进度事件。
- `Ctrl+C` 会请求停止当前任务，不会自动重放。

机器可读示例：

```bash
kunpeng task "总结当前项目" --session film-01 --json
kunpeng task "继续" --session film-01 --stream-json
kunpeng task "整理结果到 Markdown" --output-last-message result.md
```

## 2. 生图直连（不经过 Agent）

```bash
kunpeng image "雨夜老街，纪实摄影，湿润路面反射霓虹" \
  --model gpt-image-2.5 --ratio 16:9 --resolution 2k --json

kunpeng image "以参考图为准复刻汽车摄影棚三视图中的正视图" \
  --reference /absolute/path/car.png --model gpt-image-2.5

kunpeng image "电影感画面" --params '{"model":"midjourney-v82","aspect_ratio":"21:9","resolution":"2k"}'
```

直连调用鲲鹏现有 `image_generate`，仍使用应用内图片路由、参考图处理、付费幂等保护、取消逻辑和本地产物归档。外部 Bot 不需要、也拿不到供应商密钥。

## 3. 生视频直连（不经过 Agent）

```bash
kunpeng video "镜头缓慢推进，雨夜汽车驶过老街" \
  --model seedance-2.0 --duration 5 --ratio 16:9 --json

kunpeng video "参考首帧生成自然运动" \
  --model seedance-2.0 --reference /absolute/path/first-frame.png

kunpeng video "即梦多模态参考" --params '{"engine":"dreamina-seedance-2.5","image_urls":["/absolute/path/ref.png"],"duration":5,"ratio":"adaptive"}'
```

直连调用鲲鹏现有 `video_generate`，参数与工具定义一致。`--reference` 是图片快捷参数；参考视频、参考音频、文档或网页等完整参数用 `--params` 传入。

## 4. 画布与工坊直连（不经过 Agent）

画布节点生成使用 `canvas_generate`：

```bash
kunpeng canvas "为当前节点生成雨夜街角，电影感纪实摄影" \
  --node <画布节点ID> --model gpt-image-2.5 --ratio 16:9 --json

kunpeng canvas "按节点参考生成 5 秒视频" --params '{"node_id":"<节点ID>","engine":"seedance-2.0","params":{"duration":"5","ratio":"16:9"}}'
```

工坊资产/分镜生成使用 `workshop_generate`：

```bash
kunpeng workshop --kind asset --asset-id <资产ID> --json
kunpeng workshop --kind image --targets 01-01,01-02 --json
kunpeng workshop --kind video --targets 01-01 --json
```

画布会回填目标节点；工坊会按项目规则进入生成队列/确认队列并回填对应资产或分镜。工坊的异步任务返回“已排队”后，请在鲲鹏任务面板查看结果，不要重复提交。

**这些直连都是实际付费提交。CLI 不会因为网络波动或超时而自动重试；如需重做，请先核对鲲鹏任务记录。**

## 5. 停止任务

每次任务都有 `requestId`。使用 `--stream-json` 时首条 `task_started` 事件会显示它：

```bash
kunpeng cancel <requestId>
kunpeng status --json
```

退出码：`0` 成功，`1` 连接/运行错误，`2` 任务失败，`3` 本地超时，`130` 用户中止。

## 给外部 Agent 的接入说明

把下面内容加入 Codex / Kimi Code / Grok Bot 的项目说明或自定义技能：

```md
本机安装了 `kunpeng` CLI，可将需要鲲鹏项目上下文或媒体渠道的任务交给它：
- `kunpeng status`：确认鲲鹏正在运行。
- `kunpeng task "任务" --session <稳定会话名>`：由鲲鹏 Agent 执行。
- 需要自动批准工具时，仅在用户明确授权后添加 `--always-approve`。
- `kunpeng image "提示词" --json`：直接生图，不经过 Agent。
- `kunpeng video "提示词" --json`：直接生视频，不经过 Agent。
- `kunpeng canvas "提示词" --node <节点ID> --model <引擎> --json`：直接生成到画布节点。
- `kunpeng workshop --kind image --targets 01-01 --json`：直接提交工坊分镜生成。
- 用 `--params '<JSON>'` 传完整生成参数，用 `--reference` 传参考图片。
- 生成可能收费；失败后不得盲目重试，先检查任务记录和本地成品。
```
