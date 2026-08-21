# Prompt 模板

本文档包含视频风格复刻 skill 的所有 Prompt 模板。

## 风格分析 Prompt

```
你是一个专业的影视影调分析师。你的任务是分析视频的影调参数。

【严格禁止】：
- 描述任何具体画面内容（如雪山、森林、人物、建筑）
- 提取任何可识别的素材元素
- 复述视频的叙事内容

【只输出以下可通用复刻的参数】：

1. 色彩系统
   - 色温范围（K值）
   - 色调倾向（高光/阴影的色相偏移）
   - 对比度（曲线类型、高光压缩比、阴影提升幅度）
   - 饱和度（整体/高光/阴影数值）
   - 色彩映射（高光/中间调/阴影的色彩倾向）

2. 光影系统
   - 主光方向（顺/侧/逆/顶光占比）
   - 光比（硬/软光、光比数值）
   - 阴影细节保留度
   - 高光处理逻辑
   - 暗角参数（强度、范围）

3. 质感系统
   - 颗粒感/胶片感（颗粒大小、密度）
   - 锐化程度
   - 画面通透度

4. 创作逻辑（重要：基于视频的时序信息分析）
   - 运镜风格（类型、速度、顺滑度、具体运镜轨迹）
   - 构图逻辑（景别占比、构图法则、留白占比）
   - 叙事节奏（单镜头时长、剪辑节奏、镜头切换频率）
   - 整体氛围情绪

输出格式：JSON
{
  "core_tone_system": {
    "color_system": {
      "color_temperature": "...",
      "contrast": "...",
      "saturation": "...",
      "color_mapping": "..."
    },
    "light_shadow_logic": {
      "main_light_direction": "...",
      "light_ratio": "...",
      "vignette": "..."
    },
    "texture_system": {
      "grain": "...",
      "sharpness": "..."
    }
  },
  "style_creation_logic": {
    "camera_movement": "...",
    "composition": "...",
    "narrative_rhythm": "...",
    "atmosphere": "..."
  }
}
```

---

## 提示词生成 Prompt

```
基于以下影调风格模板，为场景"{scene}"生成AI视频提示词。

影调模板：
{style_template}

请生成：
1. 正面提示词（支持Pika/Runway/即梦）
   - 包含场景描述、影调参数、运镜、氛围
   - 长度控制在100-150词
   
2. 负面提示词
   - 列出需要避免的元素
   
3. 运镜建议（3-5个具体运镜方案）
4. 光影时机建议（时间段+光位）

输出格式：JSON
{
  "positive_prompt": "...",
  "negative_prompt": "...",
  "camera_suggestions": [...],
  "timing_suggestions": "..."
}
```

---

## 使用说明

### 在 Python 中使用

```python
from pathlib import Path

# 读取 Prompt 模板
skill_dir = Path(__file__).parent.parent
with open(skill_dir / "references" / "prompts.md", "r", encoding="utf-8") as f:
    content = f.read()
    
    # 提取风格分析 Prompt
    start = content.find("## 风格分析 Prompt\n\n") + len("## 风格分析 Prompt\n\n")
    end = content.find("\n---\n", start)
    ANALYZE_STYLE_PROMPT = content[start:end].strip()
```
