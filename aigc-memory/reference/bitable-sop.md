---
type: reference
category: tool-sop
tool: lark-cli
version: 1
---

# 飞书多维表格操作 SOP

## 常用操作速查

### 查看表列表
```bash
lark-cli base +tables-list --base-token <token>
```

### 查看记录
```bash
# 列表（最多 50 条）
lark-cli base +record-list --base-token <token> --table-id <tid> --limit 50

# 单条（YAML 格式）
lark-cli base +record-get --base-token <token> --table-id <tid> --record-id <rid>
```

### 创建字段
```bash
lark-cli base +field-create --base-token <token> --table-id <tid> \
  --json '{"type":"text","name":"字段名"}'

# 字段类型: text / select / multiSelect / attachment / number / date / checkbox / url
```

### 上传附件
```bash
# 必须先 cd 到文件目录！
cd /path/to/files
lark-cli base +record-upload-attachment --base-token <token> --table-id <tid> \
  --record-id <rid> --field-id <fid> --file "filename.png"
```

### 更新记录
```bash
# 更新指定记录
lark-cli base +record-upsert --base-token <token> --table-id <tid> \
  --record-id <rid> --json '{"字段名":"值"}'

# 批量创建
lark-cli base +record-batch-create --base-token <token> --table-id <tid> \
  --json '{"fields":["字段1","字段2"],"rows":[["v1","v2"],["v3","v4"]]}'
```

### 删除记录（高风险！）
```bash
lark-cli base +record-delete --base-token <token> --table-id <tid> \
  --record-id <rid> --yes
```

## 常见坑点（全部踩过，别再犯）

### 1. `--base` 是错的，要用 `--base-token`
```
# ❌ 错误
lark-cli base +record-list --base xxx

# ✅ 正确
lark-cli base +record-list --base-token xxx
```

### 2. `--name` 参数已废弃
上传附件时不要传 `--name`，文件名自动使用本地文件名。
```
# ✅ 正确
lark-cli base +record-upload-attachment ... --file "filename.png"
```

### 3. 附件上传必须用相对路径
必须 `cd` 到文件所在目录，然后使用 `--file "./xxx.png"`。
```
# ❌ 错误
lark-cli base +record-upload-attachment ... --file "/absolute/path/file.png"

# ✅ 正确
cd /path/to/files
lark-cli base +record-upload-attachment ... --file "file.png"
```

### 4. upsert 带/不带 --record-id 的行为差异
```
# 带 --record-id → 更新已有记录
lark-cli base +record-upsert ... --record-id <rid> --json '{"字段":"新值"}'

# 不带 --record-id → 创建新记录
lark-cli base +record-upsert ... --json '{"字段":"值"}'
```

### 5. Python subprocess 调用 lark-cli 的 PATH 问题
lark-cli 是 Node.js 脚本，子进程不继承 shell 环境变量，必须手动传 PATH：

```python
import subprocess
import os

env = os.environ.copy()
env['PATH'] = '/opt/homebrew/bin:' + env.get('PATH', '')
subprocess.run(["lark-cli", "base", "+record-list", ...], env=env)
```

### 6. 删除操作必须加 `--yes`
不加会阻塞等待交互确认，在脚本/子进程场景会挂起。

### 7. 主字段不能删除
默认第一个字段是主字段（primary field），`field-delete` 报 `unsafe_operation_blocked`。
`field-update --json '{"isPrimary":true}'` 也不支持（Invalid discriminator value）。
**替代方案**：将主字段重命名为"备注"保留。
```bash
lark-cli base +field-update --base-token <token> --table-id <tid> \
  --field-id <fid> --json '{"type":"text","name":"备注"}' --yes
```

### 8. field-update 必须传完整 type
只传 name 报错 `Invalid discriminator value`，必须同时传 type。
```bash
# ❌ 错误
lark-cli base +field-update ... --json '{"name":"新名称"}'

# ✅ 正确
lark-cli base +field-update ... --json '{"type":"text","name":"新名称"}'
```

### 9. field-update 需要 --yes 确认
field-update 是高风险写操作，不加 --yes 返回 `confirmation_required` 阻塞。
```bash
lark-cli base +field-update ... --json '{"type":"text","name":"新名称"}' --yes
```

### 10. record-batch-create 只支持选项 ID，不支持选项名
传选项名（如 "大远景"）报 `not_found`，必须用选项 ID（如 `[{"id":"opt7oVo9aT"}]`）。
但 `field-search-options` 和 `field-get` 返回的 options **不包含选项 ID**，无法通过 API 获取。
**替代方案**：批量创建场景使用逐条 `record-upsert`（upsert 自动解析选项名）。
```bash
# ❌ batch-create 传选项名失败
lark-cli base +record-batch-create ... \
  --json '{"fields":["景别"],"rows":[["大远景"]]}'

# ✅ 用逐条 upsert 替代
lark-cli base +record-upsert ... --json '{"景别":"大远景"}'
```

### 11. view-create 参数是单个 view 对象，不是数组
```bash
# ❌ 错误
lark-cli base +view-create ... --json '{"views":[{"name":"画廊","type":"gallery"}]}'

# ✅ 正确
lark-cli base +view-create ... --json '{"name":"画廊","type":"gallery"}'
```

### 12. view-set-card 的参数名是 cover_field
```bash
# ❌ 错误
lark-cli base +view-set-card ... --json '{"card_cover":"fldxxx"}'

# ✅ 正确
lark-cli base +view-set-card ... --json '{"cover_field":"fldxxx"}'
```

### 13. record-list 列顺序与表头一致，不要硬编码列索引
不同表格的字段顺序不同。解析 record-list 输出时：
- 先读取**表头行**确定各字段列索引
- 再用列索引定位数据行中的目标字段值
- **绝对不要**硬编码 "第 8 列是镜头号"

### 14. 场景画廊：建表初始化时就一并建好
表格默认是表格视图，不会自动展示图片。用户说"场景画廊"= 建 gallery 视图 + 设封面字段。
```bash
# 1. 建画廊视图
lark-cli base +view-create --base-token <token> --table-id <tid> \
  --json '{"name":"场景画廊","type":"gallery"}'

# 2. 设封面字段（cover_field 填附件字段的 field-id）
lark-cli base +view-set-card --base-token <token> --table-id <tid> \
  --view-id <vid> --json '{"cover_field":"fldXXXX"}'
```

### 15. select 字段值必须用已存在选项
上传数据时用了选项列表里没有的值（如"中全景"不存在）会失败。
**做法**：先 `field-update` 给该 select 字段加上这个选项，或改用已有选项值。

### 16. 中文路径用 Python subprocess 上传更稳
zsh 对中文路径转义支持差，附件上传易出错。用 Python subprocess 调 lark-cli（并传完整 PATH，见坑点 5）比直接 shell `cd`+相对路径更稳定。

### 17. 飞书文档复杂 markdown 表格用 v2 API
（属 docs 非 base，但常和表格一起用）v1 API markdown 解析有限，表格会被渲染成代码块。
```bash
lark-cli docs +update --api-version v2 --command overwrite --doc-format markdown ...
```

### 18. 附件字段需手动传文件 + 记录粒度先定
- 表格不只记文字：附件字段（场景图/资产图）需手动上传文件，建记录时就规划好、一次性传
- **建表前先定记录粒度**：按单镜头还是合并视频管理，必须与最终生成维度对齐，否则返工重建
