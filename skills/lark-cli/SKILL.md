---
name: lark-cli
visibility: library
description: >
  飞书官方 CLI 工具 (lark-cli)，在终端中操作飞书。覆盖消息、文档、多维表格、电子表格、
  日历、邮箱、任务、会议、审批等 12 大业务域，提供 200+ 命令。
  当需要通过 CLI 方式操作飞书（而非飞书 OAuth API）时使用此 Skill。
  触发词："lark-cli"、"飞书CLI"、"飞书命令行"、"lark命令"。

  适用场景：
  (1) 需要通过命令行执行飞书操作（发消息、查日程、读写文档等）
  (2) 需要批量操作飞书数据
  (3) AI Agent 需要以用户/机器人身份调用飞书 API
  (4) 需要底层 API 调试或 schema 查询
  (5) 用户提到 "lark-cli"、"飞书CLI"
---

# 飞书官方 CLI (lark-cli)

> 版本: 1.0.3 | 仓库: https://github.com/larksuite/cli | 协议: MIT

## 安装与配置

```bash
# 安装（已完成）
npm install -g @larksuite/cli

# 调用方式
npx lark-cli <command>
```

### 初始配置（仅需一次）

```bash
# 1. 配置应用凭证（后台运行，会输出授权链接发给用户）
npx lark-cli config init --new

# 2. 登录授权（后台运行，会输出授权链接发给用户）
npx lark-cli auth login --recommend

# 3. 验证状态
npx lark-cli auth status
```

### 身份切换

所有命令支持 `--as user` 或 `--as bot` 切换身份：
```bash
npx lark-cli calendar +agenda --as user
npx lark-cli im +messages-send --as bot --chat-id "oc_xxx" --text "Hello"
```

## 三层命令体系

| 层级 | 前缀 | 说明 | 示例 |
|------|------|------|------|
| 快捷命令 | `+` | 人机友好，智能默认值 | `lark-cli calendar +agenda` |
| API 命令 | 无 | 平台同步，精选 100+ | `lark-cli calendar calendars list` |
| 通用调用 | `api` | 全 API 覆盖 2500+ | `lark-cli api GET /open-apis/...` |

## 核心命令速查

### 📅 日历 (calendar)
```bash
npx lark-cli calendar +agenda                          # 今日日程
npx lark-cli calendar +create --summary "会议"          # 创建日程
npx lark-cli calendar +freebusy --user-ids "ou_xxx"    # 忙闲查询
npx lark-cli calendar calendars list                     # 日历列表
```

### 💬 即时通讯 (im)
```bash
npx lark-cli im +messages-send --chat-id "oc_xxx" --text "Hello"
npx lark-cli im +messages-send --open-id "ou_xxx" --text "私聊"
npx lark-cli im chats list                              # 群列表
npx lark-cli im +messages-list --chat-id "oc_xxx"       # 消息列表
npx lark-cli im +messages-search --query "关键词"        # 搜索消息
npx lark-cli im +resource-download --message-id "om_xxx" --file-key "img_xxx" --type image
```

### 📄 文档 (docs)
```bash
npx lark-cli docs +create --title "标题" --markdown "# 内容"
npx lark-cli docs +read --doc-id "doc_xxx"
npx lark-cli docs +update --doc-id "doc_xxx" --markdown "# 新内容"
npx lark-cli docs +search --query "关键词"
```

### 📁 云空间 (drive)
```bash
npx lark-cli drive files list --folder-token ""
npx lark-cli drive files upload --file-path "/local/file.pdf"
npx lark-cli drive files download --file-token "xxx" --output-path "/local/"
```

### 📊 多维表格 (base)
```bash
npx lark-cli base +tables-list --app-token "xxx"
npx lark-cli base +records-list --app-token "xxx" --table-id "xxx"
npx lark-cli base +records-create --app-token "xxx" --table-id "xxx" --fields '{"字段":"值"}'
```

### 📈 电子表格 (sheets)
```bash
npx lark-cli sheets +read --spreadsheet-token "xxx"
npx lark-cli sheets +write --spreadsheet-token "xxx" --values '[[1,2],[3,4]]'
npx lark-cli sheets +append --spreadsheet-token "xxx" --values '[[5,6]]'
npx lark-cli sheets +export --spreadsheet-token "xxx" --format xlsx
```

### ✅ 任务 (task)
```bash
npx lark-cli task +tasks-list
npx lark-cli task +create --summary "任务标题"
npx lark-cli task +update --task-guid "xxx" --completed true
```

### 📚 知识库 (wiki)
```bash
npx lark-cli wiki spaces list
npx lark-cli wiki nodes list --space-id "xxx"
npx lark-cli wiki nodes get --token "xxx"
```

### 👤 通讯录 (contact)
```bash
npx lark-cli contact +search-user --query "姓名"
npx lark-cli contact +get-user --user-id "ou_xxx"
```

### 📧 邮箱 (mail)
```bash
npx lark-cli mail +list
npx lark-cli mail +search --query "关键词"
npx lark-cli mail +send --to "user@example.com" --subject "标题" --body "内容"
```

### ✍️ 审批 (approval)
```bash
npx lark-cli approval +list-tasks
npx lark-cli approval +approve --instance-id "xxx"
npx lark-cli approval +reject --instance-id "xxx"
```

## 通用参数

```bash
--format json|pretty|table|ndjson|csv   # 输出格式（默认 json）
--page-all                               # 自动翻页获取所有数据
--page-limit N                           # 最多 N 页
--dry-run                                # 预览请求，不实际执行
--no-wait                                # Agent 模式，立即返回不阻塞
```

## Schema 查询（探索 API）

```bash
npx lark-cli schema                          # 所有 API
npx lark-cli schema calendar.events.create   # 指定 API 详情
```

## 通用 API 调用

```bash
npx lark-cli api GET /open-apis/calendar/v4/calendars
npx lark-cli api POST /open-apis/im/v1/messages \
  --params '{"receive_id_type":"chat_id"}' \
  --body '{"receive_id":"oc_xxx","msg_type":"text","content":"{\"text\":\"Hello\"}"}'
```

## 多维表格 (base) 完整命令

```bash
# 字段管理
lark-cli base +field-create --base-token <token> --table-id <tid> --json '{"type":"text","name":"字段名"}'
lark-cli base +field-list --base-token <token> --table-id <tid>

# 记录管理
lark-cli base +record-get --base-token <token> --table-id <tid> --record-id <rid>
lark-cli base +record-list --base-token <token> --table-id <tid> --limit 50
lark-cli base +record-upsert --base-token <token> --table-id <tid> --record-id <rid> --json '{"字段":"值"}'
lark-cli base +record-batch-create --base-token <token> --table-id <tid> --json '{"fields":["f1","f2"],"rows":[["v1","v2"]]}'
lark-cli base +record-delete --base-token <token> --table-id <tid> --record-id <rid> --yes

# 附件管理
lark-cli base +record-upload-attachment --base-token <token> --table-id <tid> --record-id <rid> --field-id <fid> --file "filename.png"
```

## 常见陷阱

### 1. 参数名是 `--base-token`，不是 `--base`
```
# ❌ lark-cli base +record-list --base xxx
# ✅ lark-cli base +record-list --base-token xxx
```

### 2. `--name` 参数已废弃
上传附件时不传 `--name`，文件名自动使用本地文件名。

### 3. 附件上传必须用相对路径
必须先 `cd` 到文件目录，再用 `--file "filename.png"`（不要用绝对路径）。

### 4. upsert 的行为差异
- 带 `--record-id` → 更新已有记录
- 不带 `--record-id` → 创建新记录

### 5. Python subprocess 的 PATH 问题
lark-cli 是 Node.js 脚本，子进程不继承 shell 环境。必须传 PATH：
```python
import os
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/bin:' + env.get('PATH', '')
subprocess.run(["lark-cli", ...], env=env)
```

### 6. 删除必须加 `--yes`
不加会阻塞等待交互确认，在脚本/子进程场景会挂起。

## 注意事项

- **安全**：操作会以用户身份执行，写操作前建议先用 `--dry-run` 预览
- **超时**：CLI 命令建议设置 `timeout=30`，批量操作设 `timeout=120`
- **授权**：首次使用需完成 `config init` + `auth login`，结果存储在系统密钥链中
- **环境**：不需要额外 API Key，通过 OAuth 登录获取权限
