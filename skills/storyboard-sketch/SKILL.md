---
name: storyboard-sketch
description: >
  电影镜头复刻分镜生成器。核心流程：原片关键帧 → 线稿草图 → 草图+人物参考 → 电影感分镜成片。
  
  使用场景：
  - 视频风格复刻（换角色换服装但保留原片构图和光影）
  - 电影/视频片段批量拆解分镜并重新生成
  - 需要精确控制AI生图的构图和光影
  
  关键词：分镜、storyboard、视频复刻、线稿草图、电影感分镜
---

# 电影镜头复刻分镜生成器

## 核心理念

复刻原片镜头的构图和光影，换上自己的角色。**构图来自原片，一切以此为锚。**

## 完整工作流

### Step 0: 视频风格分析

使用 `vision_video_analysis` 工具分析原始视频，提取视觉风格信息：

输出 `style_profile.json`：
```json
{
  "lighting": "Cool overcast daylight (6500K)",
  "colorGrading": "cool blue-gray, desaturated",
  "mood": "cinematic, contemplative",
  "filmStock": "Kodak Vision3 500T, fine grain",
  "colorTemperature": "6500K",
  "saturation": "58%",
  "contrast": "medium-high",
  "cameraCharacteristics": "Cooke S4 prime lenses, steady tracking shots"
}
```

此风格档案贯穿后续所有步骤，确保最终分镜与原片风格一致。

### 风格复用

如果已有之前生成的 `style_profile.json`，可以跳过 Step 0，直接在后续步骤中使用：
- 传给 `storyboard_sketch.py shot --style-profile path/to/style_profile.json`
- 或在 prompt 中引用风格参数

### Step 1: 原片抽帧

```bash
# 长段落：每3秒一帧
ffmpeg -ss {start} -i {video} -vf "fps=1/3" -frames:v {n} {outfiles} -y

# 需要细节的段落：每秒一帧
ffmpeg -ss {start} -i {video} -vf "fps=1" -frames:v {n} {outfiles} -y

# 极速搜索：每秒2帧
ffmpeg -ss {start} -i {video} -vf "fps=2" -frames:v {n} {outfiles} -y
```

### Step 2: 筛选9帧

用image工具批量分析帧，筛选**构图差异最大**的9帧：
- 排除构图重复的帧（同一角度、同一景别连续多帧）
- 保留：不同景别、不同角度、有人/无人、特写/远景的多样性
- 必要时可把特定用户要求的帧（如石块刹车、拿滑板）加回来

### Step 3: 批量生成草图

逐帧调用Gemini生成铅笔线稿：

```python
prompt = "Convert to clean pencil line drawing. Keep ONLY composition. Remove color, shading, text, details."
```

保存为：`{scene}_sk_{1-9}.jpg`

### Step 4: 拼3x3网格

```python
from PIL import Image
# 9张草图resize到427x240，拼成1281x720网格
# 不足9张时复制最后一帧补齐
```

保存为：`{scene}_3x3_grid.jpg`

### Step 5: 生成3x3分镜

传入：草图网格 + 人物三视图

保存为：`{scene}_3x3_final.jpg`

### Step 6: 质量检查

用image工具**逐格分析**，检查：
- 人物一致性（脸、发型、服装）
- 路人服装是否和主角撞衫
- 有无文字/水印/标注
- AI感强的格子（细节模糊、光影不匹配、肢体不自然）

### Step 7: 飞书发送 → 用户确认 → 存档

```bash
# 发送
message action=send channel=feishu media={path}

# 存档（用户确认后）
cp {path} ~/Desktop/夹缝-白日梦想家/outputs/
```

---

## 提示词工程（通用方法论）

### 人物一致性公式

```
CRITICAL COSTUME RULE: Woman wears THE EXACT SAME OUTFIT in EVERY panel:
- {逐项列出每件服装，用中文+英文}
- {每项后面加"ALWAYS on her"或"NEVER remove"}

She keeps her EXACT face from image 2 in every close/medium panel.
```

**要点**：
- 逐项列明，不要笼统说"same outfit"
- 用"ALWAYS""NEVER""MUST"等强调词
- 特殊场景单独说明服装变化（如冰川穿红色外套）

### 主角 vs 路人区分公式

```
- The WOMAN (from image 2): wears {主角服装}. She has the EXACT face from image 2.
- ALL OTHER PEOPLE: wear COMPLETELY DIFFERENT {路人服装描述}.
  They do NOT wear {主角特有服装项}. They have GENERIC faces (do NOT copy the woman's face).
- The woman's outfit MUST look different from everyone else's.
```

**要点**：
- 明确写出路人穿什么
- 明确写出路人不穿什么（主角特有项）
- 路人面部用"generic faces"，禁止AI复制主角脸

### 禁文字标准句（必加）

```
ABSOLUTELY NO TEXT of ANY KIND. This means:
- NO letters (no A-Z, no a-z)
- NO numbers (no 0-9)  
- NO words, labels, annotations, descriptions
- NO symbols that look like text
- If unsure, leave blank rather than add text
```

**要点**：
- 不能只写"NO TEXT"，AI会无视
- 必须展开说明什么类型的内容都不允许
- Gemini特别喜欢加"WIDE""CLOSE""AERIAL"等镜头标注

### 质感/材质强化公式

当需要特定材质效果时（如冰川、水面、岩石）：

```
CRITICAL {材质名} TEXTURE: {材质} must look REAL:
- {细节1：如 "deep blue crevasses with jagged irregular edges (NOT smooth geometric lines)"}
- {细节2：如 "natural imperfections, dirt spots, wind-blown patterns"}
- {正面描述}，{反面禁止}（如 "cold, ancient, raw - NOT smooth or polished"）
```

### 剪影场景公式

```
CRITICAL: ALL people are PURE DARK SILHOUETTES against {背景}. 
NO facial details visible. No skin tone visible. Pure black silhouettes.
{描述人物剪影轮廓特征：长发、帽子形状、身高对比等}
```

---

## 构图规则

### 可替换（场景层）
- 地点（城市→新疆→花海）
- 植被（草地→花田→雪地）
- 建筑（现代→毡房→传统民居）
- 天气/时段（阴天→黄金时刻）
- 原片没有但用户想要的细节动作（石块刹车、拿滑板特写等）

### 不可变（构图层）
- 摄影机角度（俯拍/仰拍/平视/航拍）
- 人物在画面中的位置（左1/3、居中、右下角等）
- 景别（远景/中景/近景/特写）
- 画面比例（16:9横幅）

### 原片没有的细节怎么办？
- 在提示词的对应Panel描述中加入新动作
- 草图网格仍然作为整体构图参考
- 新动作用文字精确描述，AI会根据构图框架填入

---

## 3x3分镜提示词结构

```
TWO images:
1st: 3x3 pencil sketches of {场景}. Composition reference only.
2nd: CHARACTER reference - this woman's EXACT face and {服装}. She appears in every panel.

CRITICAL RULES:
{人物一致性公式}
{主角vs路人区分公式（如果有多人）}
{禁文字标准句}

Create 3x3 FILM STILL GRID, 9 panels, thin dark borders, 16:9. ALL panels are {场景统一描述}.

Kodak Vision3 500T ISO 640, 5200K, 58% saturation, {色调}, fine grain.

P1: {景别} - {构图+动作+场景描述}. {情绪}.
P2: {景别} - ...
...
P9: WIDE FINAL - {结尾大景}. {情绪}.

ARRI ALEXA, Cooke S4. 16mm grain. {色调}. ZERO TEXT. NO watermark. NO AI look.
```

---

## API配置

- **端点**: `https://www.dmxapi.cn/v1/images/generations`
- **模型**: `gpt-image-2`
- **认证**: Bearer token
- **环境变量**: `DMXAPI_KEY`（在 `~/.zshrc` 中配置）
- **画幅**: `"imageConfig": {"aspectRatio": "16:9"}`

## 参考图最佳实践

- **数量**：2-3张（草图网格+人物三视图），传太多timeout
- **分辨率**：压缩到600px、quality=50传入，1K比2K稳定
- **草图网格**：1281x720 (9×427x240)，质量85
- **人物三视图**：必须传入，是人物一致性的唯一锚点

## 多轮微调

- R1→分析问题→R2修正，比单轮强
- 例：R1有门→"NO DOORS"→R2修正成功
- 修正时传入R1图片+指出具体问题

## 中文文字生成（底层能力缺陷）

AI不是"写字"是"画像素"，笔画越多越容易画错。

**核心原则**：文字越少越准确，其余抽象化
- 1-3字：大概率正确
- 4-6字：可接受
- 7+字：高风险
- 段落：不可能正确，必须抽象化

**策略**：只保留2-5个核心文字，其余用抽象色块代替。指定黑体，明确禁止自由发挥。

## 依赖

- Python 3.9+
- PIL/Pillow
- DMXAPI_KEY环境变量
- ffmpeg（抽帧）
- image工具（帧筛选+质量检查）
