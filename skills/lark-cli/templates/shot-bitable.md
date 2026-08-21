# 飞书多维表格「分镜管理」模板与配置规范

> 本模板配合 AIGC 项目工作台使用：从 ~/.kunpeng/aigc-memory/projects/<id>/ 读取分镜/资产/场景图，一键创建并填充飞书多维表格。

---

## 0. 参数化说明

调用方传入：

| 参数 | 来源 | 示例 |
|---|---|---|
| 项目名 | `project.json :: name` | "向往S7 · 降临" |
| slug | `project.json :: slug` | "xiangwang-s7" |
| 自动编号前缀 | `slug.toUpperCase().slice(0,4) + "-"` | `XIAN-` / `S7-` |
| 三幕标题 | `parsed/shots.json` 中 distinct(act) | "第一幕·亮相" 等 |
| 视频引擎默认 | `project.json :: videoEngine` | "dreamina" or "rhtv" |

> 老项目（向往 S7）使用的前缀是 `S7-`，由调用方按需覆盖。

---

## 1. 核心工作流

```
创建多维表格 → 建表和字段 → 批量填入分镜记录
    → 上传场景图 + 车辆资产图
    → 用户勾选"确认"
    → AI 生成视频 → 上传回"生成视频"字段
    → 更新"生成状态"为已完成
```

### 1.1 分镜制作流程（三幕结构）

| 幕 | 镜头范围（示例） | 内容 | 视觉风格 |
|---|---|---|---|
| 第一幕·亮相 | 01-①~01-⑥, 02 | 主体细节特写 + 全景亮相 | 项目设定 |
| 第二幕·装配 | 03~08 | 装配过程 | 项目设定 |
| 第三幕·入城 | 09~11 | 巡游/场景应用 | 项目设定 |

### 1.2 确认→生成流程

```
用户勾选「确认」checkbox
  → Claude 读取确认状态（确认=true 且 生成状态≠已完成）
  → 从 bitable 获取视频提示词、资产图、视频引擎字段
  → 按视频引擎路由：
    · dreamina  → dreamina multimodal2video (seedance2.0_vip)
    · rhtv      → runninghub.py seedance2.0
  → 下载视频 → 上传到「生成视频」字段
  → 更新「生成状态」为"已完成"
```

---

## 2. 字段配置规范

### 2.1 字段总览（21 个字段）

| 字段名 | 类型 | ID | 说明 |
|--------|------|----|------|
| 文本 | text(primary) | fldn83obA9 | 主字段，自动创建 |
| 编号 | auto_number | fldonWdi1R | 自动编号，格式 `<前缀>-001` |
| 镜号 | text | fldsW0KA8E | 如 `01-①`, `02`, `03`... |
| 幕 | select | fldUTriali | 三幕单选 |
| 景别 | text | fldGRs06vQ | 如"极特写""全景→定帧" |
| 分镜描述 | text | fldtGCgxQm | 画面描述原文 |
| 运镜 | text | fldWhBbASH | 镜头运动描述 |
| 时长 | text | fld8nftlva | 如 `1.5s`, `7s` |
| 视频提示词 | text | fldZqDCDmR | 视频生成提示词（flat格式） |
| 场景图 | attachment | fldSGnTRUU | 环境参考图 |
| 车辆资产图 | attachment | fldfnEMQb4 | 资产模型参考图 |
| 生成视频 | attachment | fldh0YnVZr | 最终生成的视频（可预览） |
| 视频生成结果 | text | — | 视频生成的结果描述或备注 |
| 确认 | checkbox | fldGVWEDB2 | 用户勾选确认 |
| 视频引擎 | select | — | 单选: dreamina / rhtv（覆盖项目默认） |
| 生成状态 | select | fldwHoO32f | 待确认/已确认/生成中/已完成 |
| 完成进度 | number(progress) | fldnbyoYW7 | 蓝粉渐变进度条 |
| 创建时间 | created_at | fldwbUAa6l | 系统自动 |
| 更新时间 | updated_at | fld61YdFNg | 系统自动 |
| 创建人 | created_by | fldz6Jd1P8 | 系统自动 |
| 参考链接 | text(url) | fldojNtqWY | 外部文档链接 |

> 字段 ID 仅作为旧项目（向往 S7）的对照；新建项目时由 lark-cli 自动分配。

### 2.2 Select 字段选项

#### 幕

| 选项 | 颜色(hue) | 色度(lightness) |
|------|-----------|-----------------|
| 第一幕·亮相 | Blue | Lighter |
| 第二幕·装配 | Green | Light |
| 第三幕·入城 | Orange | Light |

> 实际选项由 parsed/shots.json 中 distinct(act) 决定，颜色按顺序分配 Blue/Green/Orange/Red/Cyan。

#### 视频引擎

| 选项 | 颜色(hue) |
|------|-----------|
| dreamina | Blue |
| rhtv | Purple |

#### 生成状态

| 选项 | 颜色(hue) | 色度(lightness) |
|------|-----------|-----------------|
| 待确认 | Orange | Lighter |
| 已确认 | Red | Lighter |
| 生成中 | Gray | Lighter |
| 已完成 | Blue | Lighter |

### 2.3 字段类型速查

| 场景 | Lark-cli JSON |
|------|--------------|
| 文本 | `{"type":"text","name":"字段名"}` |
| 单选 | `{"type":"select","multiple":false,"options":[{"name":"选项","hue":"Blue"}]}` |
| 多选 | `{"type":"select","multiple":true,"options":[...]}` |
| 复选框 | `{"type":"checkbox","name":"确认"}` |
| 附件 | `{"type":"attachment","name":"场景图"}` |
| 自动编号 | `{"type":"auto_number","name":"编号","style":{"rules":[{"type":"text","text":"<前缀>-"},{"type":"incremental_number","length":3}]}}` |
| 进度条 | `{"type":"number","name":"完成进度","style":{"type":"progress","percentage":true,"color":"BlueToPinkGradient"}}` |
| 创建时间 | `{"type":"created_at","name":"创建时间","style":{"format":"yyyy/MM/dd HH:mm"}}` |
| 更新时间 | `{"type":"updated_at","name":"更新时间","style":{"format":"yyyy/MM/dd HH:mm"}}` |
| 创建人 | `{"type":"created_by","name":"创建人"}` |
| URL链接 | `{"type":"text","name":"参考链接","style":{"type":"url"}}` |

---

## 3. 视图架构

### 3.1 视图总览

| 视图名 | 类型 | 排序 | 分组 | 封面 |
|--------|------|------|------|------|
| 分镜总览 | grid | 镜号 asc | — | — |
| 场景画廊 | gallery | 镜号 asc | — | 场景图 |
| 制作看板 | kanban | 镜号 asc | 生成状态 | 场景图 |

### 3.2 视图字段可见性

- **分镜总览（grid）**：编号 → 镜号 → 幕 → 景别 → 场景图 → 生成视频 → 完成进度 → 确认 → 视频引擎 → 生成状态 → 创建时间
- **场景画廊（gallery）**：镜号 → 幕 → 景别 → 场景图 → 生成视频 → 生成状态
- **制作看板（kanban）**：镜号 → 幕 → 景别 → 场景图 → 生成视频 → 生成状态

### 3.3 镜号排序规则

镜号为文本类型，按 ASCII 字典序升序。因此：
- **零填充**确保正确排序：`01-①` `02` `03` ... `09` `10` `11`
- 子镜号使用 `01-①` ~ `01-⑥` 格式，统一在 `02` 之前

---

## 4. 仪表盘设计

### 4.1「制作进度」仪表盘

布局结构（auto-arrange 自动布局）：

```
┌──────────┬──────────┬──────────┐
│ 总镜头数  │  待确认   │  已完成   │  ← 指标卡行
├──────────┴──────────┴──────────┤
│       侧边导航（项目信息）       │  ← 导航行
├──────────┬──────────────────────┤
│ 各幕分布  │    生成进度分布       │  ← 图表行
│ (柱状图)  │      (饼图)          │
└──────────┴──────────────────────┘
```

### 4.2 仪表盘块类型

| 块名称 | 类型 | data_config 要点 |
|--------|------|-----------------|
| 侧边导航 | text | `{"text":"# 标题\\n内容"}` |
| 总镜头数 | statistics | `{"table_name":"分镜表","count_all":true}` |
| 待确认 | statistics | `{"table_name":"分镜表","count_all":true,"filter":{"conjunction":"and","conditions":[{"field_name":"生成状态","operator":"is","value":"待确认"}]}}` |
| 已完成 | statistics | 同上，`value` 改为 "已完成" |
| 各幕镜头分布 | column | `{"table_name":"分镜表","count_all":true,"group_by":[{"field_name":"幕","mode":"integrated"}]}` |
| 生成进度分布 | pie | `{"table_name":"分镜表","count_all":true,"group_by":[{"field_name":"生成状态","mode":"integrated"}]}` |

---

## 5. 设计规范

### 5.1 颜色系统

| 用途 | 色值 |
|------|------|
| 第一幕 | Blue |
| 第二幕 | Green |
| 第三幕 | Orange |
| 待确认状态 | Orange |
| 已确认状态 | Red |
| 生成中状态 | Gray |
| 已完成状态 | Blue |
| 进度条 | BlueToPinkGradient |
| dreamina 引擎 | Blue |
| rhtv 引擎 | Purple |

### 5.2 命名规范

- 字段名：中文，简洁精确（"镜号""景别""运镜"）
- 视图名：中文，带功能描述（"分镜总览""场景画廊""制作看板"）
- select 选项：中文，带分隔符清晰区分（"第一幕·亮相""待确认"）
- 自动编号前缀：项目 slug 前 4 字符大写 + 三位数字（如 `S7-001`、`XIAN-001`）

### 5.3 视图设计原则

1. **分镜总览（grid）**：信息密度最高，完整展示所有字段
2. **场景画廊（gallery）**：视觉优先，大图封面 + 精简文字，适合浏览
3. **制作看板（kanban）**：流程驱动，按状态分组，适合管理进度

### 5.4 镜号编码规则

| 格式 | 示例 | 说明 |
|------|------|------|
| `01-①` | 01-① ~ 01-⑥ | 第一镜的子分镜 |
| `02` | 02 ~ 11 | 独立分镜（零填充到2位） |

---

## 6. 视频生成结果管理

### 6.1 引擎 A：dreamina

```bash
# 提交
dreamina multimodal2video --model seedance2.0_vip \
  --prompt "<视频提示词>" \
  --image "<场景图本地路径>" \
  --image "<资产图本地路径>"
# 返回 submit_id；前端 register background_task type=dreamina

# 查询/下载
dreamina query_result --submit_id=<submit_id> --download_dir=/tmp/openclaw/
dreamina list_task --limit=10
```

### 6.2 引擎 B：rhtv (RunningHub seedance2.0)

```bash
python3 ~/.kunpeng/skills/rhtv/scripts/runninghub.py \
  --workflow seedance2.0 \
  --prompt "<视频提示词>" \
  --refs "<场景图>,<资产图>" \
  --output /tmp/openclaw/<shotNo>.mp4
```

### 6.3 上传视频到多维表格

```bash
lark-cli base +record-upload-attachment \
  --base-token <token> \
  --table-id <table> \
  --record-id <record_id> \
  --field-id "生成视频" \
  --file "video.mp4" \
  --as user
```

---

## 7. 视频提示词模板

遵循 aigc-memory skill 的 seedance 模板格式：

```
## 画面描述
{风格}，{主体} {动作}，{场景}

## 运镜指令
{镜头运动}

## 参数
- 模型：Seedance Video
- 比例：16:9
- 时长：{duration}s
- 风格：{项目风格标识}
```

---

## 8. 附录

### 8.1 技术要点

- **lark-cli 版本要求**：`>= 1.0.19`（当前 1.0.38）
- **认证方式**：OAuth 用户登录 (`lark-cli auth login --recommend`)
- **所有命令加 `--as user`**：确保以用户身份操作
- **附件上传**：必须使用 `record-upload-attachment`，不可伪造 CellValue
- **主字段不可删除**：`文本` 是 primary field，无法删除

### 8.2 项目目录约定

```
~/.kunpeng/aigc-memory/projects/<id>/
├── project.json
├── parsed/shots.json          ← 写入 record 时主数据来源
├── prompts/video-prompts.json ← 写入「视频提示词」字段
├── scenes/variants/<shotNo>.jpg ← 上传到「场景图」字段
├── assets/<assetId>.jpg         ← 上传到「车辆资产图」字段
└── bitable.json                  ← 创建后回写 baseToken/tableId/recordIds
```
