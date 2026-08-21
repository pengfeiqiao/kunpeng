# 影调风格 JSON Schema

本文档定义了视频风格复刻 skill 的标准化影调参数格式。

## 完整 Schema

```json
{
  "style_id": "自动生成唯一ID（UUID）",
  "style_name": "用户自定义风格名称",
  "style_tags": ["标签1", "标签2", "标签3"],
  "core_tone_system": {
    "color_system": {
      "color_temperature": "色温范围描述（如：5500K-6500K，高光暖金3000K，阴影冷青7500K）",
      "contrast": "对比度描述（如：高对比度，S型曲线，高光压缩15%，阴影提升10%）",
      "saturation": "饱和度描述（如：中低饱和度，高光+10%，阴影-20%）",
      "color_mapping": "色彩映射描述（如：高光：暖橙/暖金，中间调：中性，阴影：青蓝/冷绿）"
    },
    "light_shadow_logic": {
      "main_light_direction": "主光方向（如：侧逆光70% + 顺光30%）",
      "light_ratio": "光比（如：软光，光比1:4，阴影保留80%细节）",
      "vignette": "暗角参数（如：强度15%，范围80%）"
    },
    "texture_system": {
      "grain": "颗粒感（如：中等胶片颗粒，密度10%）",
      "sharpness": "锐化程度（如：中等锐化，仅强化边缘）"
    }
  },
  "style_creation_logic": {
    "camera_movement": "运镜风格（如：慢推/慢环绕，速度0.5x）",
    "composition": "构图逻辑（如：全景60% + 中景30% + 特写10%）",
    "narrative_rhythm": "叙事节奏（如：单镜头4-6秒，慢节奏）",
    "atmosphere": "氛围情绪（如：静谧、治愈、宏大、有呼吸感）"
  },
  "source_info": {
    "source_video_link": "原视频链接（仅记录，不存储素材）",
    "create_time": "创建时间（ISO 8601格式）"
  }
}
```

---

## 字段说明

### 必填字段

- **style_name**: 风格名称（用户输入）
- **core_tone_system**: 核心影调系统
  - **color_system**: 色彩系统
    - **color_temperature**: 色温范围
    - **contrast**: 对比度
    - **saturation**: 饱和度
    - **color_mapping**: 色彩映射
  - **light_shadow_logic**: 光影系统
    - **main_light_direction**: 主光方向
    - **light_ratio**: 光比
  - **texture_system**: 质感系统
    - **grain**: 颗粒感
    - **sharpness**: 锐化程度
- **style_creation_logic**: 创作逻辑
  - **camera_movement**: 运镜风格
  - **composition**: 构图逻辑
  - **narrative_rhythm**: 叙事节奏
  - **atmosphere**: 氛围情绪

### 可选字段

- **style_id**: 自动生成的唯一ID
- **style_tags**: 标签数组（用于搜索和分类）
- **vignette**: 暗角参数（可选）
- **source_info**: 来源信息（用于追溯）

---

## 示例

### 示例1：治愈暖调风格

```json
{
  "style_name": "治愈暖调",
  "style_tags": ["旅拍", "治愈", "电影感", "暖调"],
  "core_tone_system": {
    "color_system": {
      "color_temperature": "5500K-6500K，整体偏暖，高光暖金3000K，阴影冷青7500K",
      "contrast": "高对比度，S型曲线，高光压缩15%，阴影提升10%",
      "saturation": "整体中低饱和度，高光饱和度+10%，阴影饱和度-20%",
      "color_mapping": "高光：暖橙/暖金，中间调：自然中性，阴影：青蓝/冷绿"
    },
    "light_shadow_logic": {
      "main_light_direction": "侧逆光为主，占比70%，顺光辅助占比30%",
      "light_ratio": "软光为主，光比1:4，阴影保留80%细节",
      "vignette": "轻微暗角，强度15%，范围80%，聚焦画面中心"
    },
    "texture_system": {
      "grain": "轻微胶片颗粒，颗粒大小中等，密度10%",
      "sharpness": "中等锐化，仅强化边缘，不破坏画面通透度"
    }
  },
  "style_creation_logic": {
    "camera_movement": "慢推、慢环绕为主，运镜速度0.5x，平稳顺滑",
    "composition": "全景占比60%，中景30%，特写10%，三分法构图，画面留白30%",
    "narrative_rhythm": "单镜头时长4-6秒，慢节奏剪辑，无快切",
    "atmosphere": "静谧、治愈、宏大、有呼吸感"
  }
}
```

### 示例2：冷调史诗风格

```json
{
  "style_name": "冷调史诗",
  "style_tags": ["史诗", "冷调", "风光", "宏大"],
  "core_tone_system": {
    "color_system": {
      "color_temperature": "7500K-9500K，整体冷调，高光冷白8000K，阴影深蓝12000K",
      "contrast": "极高对比度，高光压缩20%，阴影提升5%",
      "saturation": "极低饱和度，整体-30%",
      "color_mapping": "高光：冷白/银灰，中间调：中性偏蓝，阴影：深蓝/青黑"
    },
    "light_shadow_logic": {
      "main_light_direction": "逆光为主，占比80%，侧光辅助20%",
      "light_ratio": "硬光，光比1:8，阴影保留60%细节",
      "vignette": "强暗角，强度30%，范围60%"
    },
    "texture_system": {
      "grain": "明显胶片颗粒，颗粒较大，密度20%",
      "sharpness": "强锐化，强化质感和边缘"
    }
  },
  "style_creation_logic": {
    "camera_movement": "大范围环绕、极速飞越，运镜速度1.5x-2x",
    "composition": "极全景80%，远景20%，中心构图，画面留白50%",
    "narrative_rhythm": "单镜头时长2-4秒，快节奏剪辑，频繁切换",
    "atmosphere": "史诗、宏大、冷峻、震撼"
  }
}
```

---

## 使用场景

### 1. 保存风格

```python
import json
from pathlib import Path

# 生成风格配置
style_config = {
    "style_name": "治愈暖调",
    "core_tone_system": {...},
    "style_creation_logic": {...}
}

# 保存到桌面
style_dir = Path.home() / "Desktop" / "视频复刻" / "治愈暖调"
style_dir.mkdir(parents=True, exist_ok=True)

with open(style_dir / "style-config.json", "w", encoding="utf-8") as f:
    json.dump(style_config, f, ensure_ascii=False, indent=2)
```

### 2. 读取风格

```python
import json
from pathlib import Path

# 读取风格配置
style_dir = Path.home() / "Desktop" / "视频复刻" / "治愈暖调"
with open(style_dir / "style-config.json", "r", encoding="utf-8") as f:
    style_config = json.load(f)

# 使用风格参数
color_system = style_config["core_tone_system"]["color_system"]
print(f"色温范围: {color_system['color_temperature']}")
```

---

## 验证 Schema

可以使用 JSON Schema 验证器确保配置格式正确：

```python
import jsonschema

# 定义 Schema
schema = {
    "type": "object",
    "required": ["style_name", "core_tone_system", "style_creation_logic"],
    "properties": {
        "style_name": {"type": "string"},
        "style_tags": {
            "type": "array",
            "items": {"type": "string"}
        },
        "core_tone_system": {
            "type": "object",
            "required": ["color_system", "light_shadow_logic", "texture_system"],
            # ... 更多属性定义
        },
        # ... 更多属性定义
    }
}

# 验证配置
jsonschema.validate(style_config, schema)
```
