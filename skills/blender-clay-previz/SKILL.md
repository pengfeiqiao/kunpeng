---
name: blender-clay-previz
displayName: Blender 白模运镜
description: 用户提到白模/白膜/运镜预演/previs 时使用。调用本机 Blender 无界面渲染极简白模场景与运镜视频，用于验证构图遮挡、空间调度与动作时机，也可作为 AI 视频生成的全能参考。
category: visual
visibility: toolbar
triggers: 白模,白膜,运镜,预演,previs,previz,clay,3D 运镜,空间调度
---

# Blender 白模运镜（Clay Previz）

用户要求通用建模、材质或修改已有工程时使用 blender-modeling，不要仅因出现 Blender 一词进入白模流程。

用本机 Blender 把场景搭成极简白模（全部方块/圆柱概括、统一白色材质、不要纹理细节），
渲染带运镜的预演视频。核心价值：**静态图说明外观，白模说明随时间变化的空间关系**——
构图遮挡、人物相对位置、镜头运动、动作交接时机。

## 什么时候主动引导用户做白模

不是每条视频都需要白模。只有当需求**依赖随时间变化的空间关系**时才值得做：

- 运镜复杂（推拉升降、环绕、POV 切换、跟拍穿越）。
- 多人物/多物体有相对位移、遮挡、追逐、交接（递枪、接力、碰撞）。
- 动作时机必须精确（撞上扶手再滑下、起身时机、镜头内出入画）。
- AI 视频反复出现空间错乱（人穿墙、位置关系不对、镜头走向不对）。

以上信号出现时，主动建议：「这个镜头依赖空间关系随时间的变化，建议先用 Blender
做个白模运镜验证调度，再拿白模视频当参考去生成，成功率会高很多。」
纯静态画面、单人口播、氛围空镜不需要白模，直接生图/生视频。

## 动手前必须问清（需求引导）

信息不全时先问，不要猜着直接渲：

1. **场景与参考**：什么场景？有没有参考图/参考片/剧本分镜？（有就先读取再建模）
2. **镜头运动**：机位怎么动？（如：从高位缓降推进、手持跟拍、绕人半周）什么焦段感？
3. **时长与比例**：几秒（默认 5s）、16:9 还是 9:16、帧率（默认 24）。
4. **人形精度档位**（动作精度三档，按需求选，不要过度建模）：
   - 1 档·站位/粗略移动 → 极简胶囊人（`detail: 1`）
   - 2 档·特定姿态 → 四肢清楚的人形（`detail: 2`，可摆手臂/腿角度）
   - 3 档·精准动作（骨骼+连续运动）→ 用 2 档分多镜近似，或明确告诉用户需要人工绑定
5. **用途**：纯预演看一下，还是要当 AI 视频的全能参考？（影响精度与时长建议）

## 工作流

### 1. 探测 Blender

按顺序探测，命中即止，并把路径记下来复用：

```bash
# macOS
ls "/Applications/Blender.app/Contents/MacOS/Blender" 2>/dev/null
ls "$HOME/Applications/Blender.app/Contents/MacOS/Blender" 2>/dev/null
which blender
# Windows（Git Bash）
ls "/c/Program Files/Blender Foundation"/Blender*/blender.exe 2>/dev/null
# Linux
which blender || ls /usr/bin/blender /snap/bin/blender 2>/dev/null
```

然后 `"<blender>" --version` 确认 ≥ 4.0。找不到就明确告诉用户需要先安装
Blender（免费，blender.org），不要静默跳过。

### 2. 写 spec.json 并渲染

渲染脚本是技能自带的 `scripts/clay_render.py`（字段规范见脚本头部注释，先读再写）。
**所有路径必须绝对路径**；坐标单位米、旋转单位度。

```bash
"<blender>" -b --factory-startup -P <技能目录>/scripts/clay_render.py -- /abs/path/spec.json
```

- 日志是 `CLAY_RENDER {...}` JSON 行：非零退出码或 `"status": "error"` 时按 error/trace 排障。
- 渲染时长：EEVEE 约 1-3 帧/秒，5 秒 24fps 的场景几分钟内完成；长镜头先渲 1-2 秒验证再渲全片。

### 3. 必须抽帧目检（验证纪律）

渲染完成后**不许直接交付**，先验证：

```bash
ffmpeg -y -i out.mp4 -vf "select=eq(n\,0)" -vframes 1 first.png   # 首帧
ffmpeg -y -sseof -0.1 -i out.mp4 -vframes 1 last.png              # 尾帧
# 长片再抽中间若干帧
```

用原生视觉或 image_recognition 逐帧核对：构图是否还原需求、遮挡关系对不对、
相机路径有没有穿墙/切到人、动作时机是否在正确的帧。失败就改 spec 重渲。

### 4. 交付与迭代

- 成品视频放工作区 `videos/`（如 `videos/clay-previz-xxx.mp4`），给用户 file:// 链接。
- spec.json 保留在同目录，方便用户改需求后增量重渲（改镜头/改动作只动对应字段）。

## 错误出现在哪一层，就回哪一层改

| 症状 | 回哪层改 |
| --- | --- |
| 空间错（位置/遮挡/穿墙/镜头走向不对） | 改 spec.json 的白模与相机路径，重渲 |
| 动作僵（移动生硬、姿态不对） | 补 motion 关键帧与受力链（先蹲下再跳、先抬臂再递），细化 limbs 姿态 |
| 身份错（AI 视频里人/物对不上） | 不是白模问题——查生视频时的资产图 ID 与交接时间戳 |

## 作为 AI 视频全能参考的衔接

白模视频喂给 Seedance/即梦等生成时，提示词里必须写清边界：

- **白模视频只参考**：空间调度、视角顺序、人物相对位置、动作与交接节点。
- **外观另给**：角色/场景/道具的外观用资产图（@图片N），不让模型从白模推断材质。
- 配**秒级时间戳分镜**（`[00:00-00:01] 两人入画，高位压近……`）逐段描述画面；
  复杂镜头不是另一套逻辑，只是交代得更具体。

## 工坊分镜的注入通道

在工坊（workshop）场景为某一镜做的白模视频，验证通过后**先询问用户是否注入**，
用户同意再写入：

```
workshop_update_shot_refs {"shot_no":"<编号>","add_previs_video_paths":["/abs/path/clay.mp4"]}
```

- 该字段（directorPrevisVideoPaths）是视频运动参考，不占 @图片N 编号；下次「生成视频」
  自动作为参考视频提交给 Seedance。注入后重写该镜 videoPrompt：开头写明
  「@视频N（白模预演视频）只参考空间调度、视角顺序、人物相对位置与动作交接节点」，
  外观仍以 @图片N 资产为准。
- 读取当前已挂白模视频：workshop_get_shot_refs 返回的 `directorPrevisVideoPaths`。
- 移除：同工具 `remove_previs_video_paths`。

## spec 编写要点

- **概括原则**：元素全部用方块/圆柱/球概括（汽车=车身方块+轮圆柱，店面=盒子+招牌薄片），
  表面纹理一律不做。白模的价值在空间关系，不在细节。
- **构图还原**：有参考图时先分析纵深关系、两侧密度、近大远小，再按统一比例摆放；
  相机第一帧的构图必须能对上参考图。
- **相机路径**：`camera.path` 至少首尾两个关键帧；`look_at` 决定视线终点；
  `interpolation: "bezier"`（默认，缓入缓出）或 `"linear"`（匀速，机械感/手持替代）。
- **人形档位**：见上「人形精度档位」；`limbs` 角度单位度。
- **环境**：默认自带大地面 + 三点柔光 + 亮灰白背景（突出白模体积与阴影），一般不用改。
- **渲染引擎**：默认 EEVEE（失败自动回退 Workbench 白模线框感）；纯构图验证可显式
  `"engine": "workbench"`，速度最快。

## 故障排查

- `blender: command not found` / 路径不存在 → 回到第 1 步探测；确认后引导用户安装。
- `"status": "error"` → 读 trace 字段：多为 spec 字段类型错误（数组长度、字符串写成数字）。
- 渲染全黑/全白 → 检查相机是否对着场景（look_at 方向）、物体是否在原点附近。
- 超时 → 先降 `duration_sec` 或分辨率验证管线，再渲全片；Workbench 引擎最快。


## 可编辑工程

脚本在渲染前及完成后保存同名 `.blend`，可用 spec 的 `blend_output` 指定绝对路径。
交付时附工程及预演视频；另启 Blender 无界面进程重新打开工程，检查相机、对象与动画帧范围后才称保存验证通过。已有工程编辑走 blender-modeling，本脚本清场行为只适用于新建白模。
