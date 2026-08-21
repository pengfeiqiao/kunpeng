#!/usr/bin/env python3
"""
分析视频的科幻元素和巨物逻辑
补充影调分析，提取视觉内容元素
"""
import argparse
import json
from pathlib import Path
import sys
import os
import base64
import requests

# 添加父目录到路径
sys.path.append(str(Path(__file__).parent.parent))

# 输出目录
OUTPUT_DIR = Path.home() / "Desktop" / "视频复刻"

SCI_FI_ANALYSIS_PROMPT = """
你是一个专业的科幻影视视觉分析师。请分析这个视频中的科幻视觉元素和巨物逻辑。

【重要】请详细描述以下内容：

## 1. 科幻视觉元素清单
列出视频中出现的所有科幻/未来主义元素：
- 抽象巨物结构（几何形态、尺寸比例、材质质感）
- 发光装置（颜色、强度、动态效果）
- 悬浮物体（形态、运动轨迹）
- 能量效果（粒子、光束、涟漪等）
- 几何纹理/网格（覆盖位置、密度、颜色）
- 其他科幻元素

## 2. 元素与环境的融合方式
描述科幻元素如何与自然环境结合：
- 嵌入方式（生长感/放置感/悬浮感）
- 材质过渡（自然→科幻的渐变）
- 光影交互（科幻元素的光与自然光的融合）
- 比例关系（科幻元素与环境的尺度对比）

## 3. 巨物逻辑分析
分析视频中"巨大物体"的呈现方式：
- 巨物类型（建筑/自然物/抽象结构）
- 尺度参照（如何体现"巨大"）
- 视觉压迫感（镜头角度、距离、运动）
- 与人的关系（渺小感/敬畏感/探索感）

## 4. 叙事逻辑
分析视频的叙事节奏：
- 开场→推进→高潮→结尾的镜头逻辑
- 镜头切换的节奏（快/慢/渐变）
- 观众视角变化（远→近/宏观→微观）
- 情绪曲线（探索/震撼/孤寂/敬畏）

## 5. 关键帧描述
选取3-5个最具代表性的画面，详细描述：
- 画面构图
- 科幻元素位置和状态
- 光影效果
- 运镜方式
- 情绪氛围

输出格式：JSON
{
  "scifi_elements": {
    "giant_structures": [...],
    "glowing_devices": [...],
    "floating_objects": [...],
    "energy_effects": [...],
    "geometric_textures": [...],
    "other_elements": [...]
  },
  "environment_integration": {
    "embedding_style": "...",
    "material_transition": "...",
    "light_interaction": "...",
    "scale_relationship": "..."
  },
  "giant_object_logic": {
    "types": [...],
    "scale_reference": "...",
    "visual_pressure": "...",
    "human_relationship": "..."
  },
  "narrative_logic": {
    "story_arc": "...",
    "editing_rhythm": "...",
    "perspective_changes": "...",
    "emotion_curve": "..."
  },
  "key_frames": [
    {
      "composition": "...",
      "scifi_placement": "...",
      "lighting": "...",
      "camera": "...",
      "mood": "..."
    }
  ]
}
"""

class DMXAPIClient:
    """DMXAPI 客户端"""
    
    def __init__(self):
        self.api_key = os.environ.get("DMXAPI_KEY")
        if not self.api_key:
            raise ValueError("❌ DMXAPI_KEY 未配置")
        self.base_url = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
    
    def analyze_video(self, video_path, prompt):
        """直接分析视频（豆包向量化API）"""
        with open(video_path, "rb") as f:
            video_base64 = base64.b64encode(f.read()).decode()
        
        content = [
            {"type": "text", "text": prompt},
            {
                "type": "video_url",
                "video_url": {
                    "url": f"data:video/mp4;base64,{video_base64}"
                }
            }
        ]
        
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "doubao-seed-2-0-pro-260215",
                "messages": [{"role": "user", "content": content}]
            },
            timeout=180
        )
        
        return response.json()


def main():
    parser = argparse.ArgumentParser(description="分析视频科幻元素")
    parser.add_argument("--file", required=True, help="本地视频文件路径")
    parser.add_argument("--output", help="输出目录名称")
    args = parser.parse_args()
    
    # 初始化客户端
    client = DMXAPIClient()
    
    # 检查文件
    video_path = Path(args.file).expanduser().absolute()
    if not video_path.exists():
        print(f"❌ 文件不存在: {video_path}")
        return
    
    print(f"📁 分析视频: {video_path}")
    print("🔍 正在分析科幻元素（豆包向量化API）...")
    
    # 分析视频
    result = client.analyze_video(video_path, SCI_FI_ANALYSIS_PROMPT)
    
    if "choices" not in result:
        print(f"❌ 分析失败: {result}")
        return
    
    content = result["choices"][0]["message"]["content"]
    
    # 解析JSON
    try:
        analysis = json.loads(content)
    except json.JSONDecodeError:
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            json_str = content[start:end].strip()
            analysis = json.loads(json_str)
        else:
            print("❌ 无法解析结果")
            print(f"原始内容:\n{content}")
            return
    
    # 保存结果
    output_name = args.output or video_path.stem
    output_dir = OUTPUT_DIR / output_name
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 保存JSON
    json_path = output_dir / "scifi-analysis.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"✅ 科幻元素分析已保存: {json_path}")
    
    # 生成报告
    report_path = output_dir / "scifi-report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# {output_name} - 科幻元素分析报告\n\n")
        
        # 科幻元素清单
        f.write("## 1. 科幻视觉元素\n\n")
        elements = analysis.get("scifi_elements", {})
        
        if elements.get("giant_structures"):
            f.write("### 抽象巨物结构\n")
            for item in elements["giant_structures"]:
                f.write(f"- {item}\n")
            f.write("\n")
        
        if elements.get("glowing_devices"):
            f.write("### 发光装置\n")
            for item in elements["glowing_devices"]:
                f.write(f"- {item}\n")
            f.write("\n")
        
        if elements.get("floating_objects"):
            f.write("### 悬浮物体\n")
            for item in elements["floating_objects"]:
                f.write(f"- {item}\n")
            f.write("\n")
        
        if elements.get("energy_effects"):
            f.write("### 能量效果\n")
            for item in elements["energy_effects"]:
                f.write(f"- {item}\n")
            f.write("\n")
        
        if elements.get("geometric_textures"):
            f.write("### 几何纹理\n")
            for item in elements["geometric_textures"]:
                f.write(f"- {item}\n")
            f.write("\n")
        
        # 环境融合
        f.write("## 2. 环境融合方式\n\n")
        integration = analysis.get("environment_integration", {})
        f.write(f"- **嵌入方式**: {integration.get('embedding_style', '')}\n")
        f.write(f"- **材质过渡**: {integration.get('material_transition', '')}\n")
        f.write(f"- **光影交互**: {integration.get('light_interaction', '')}\n")
        f.write(f"- **比例关系**: {integration.get('scale_relationship', '')}\n\n")
        
        # 巨物逻辑
        f.write("## 3. 巨物逻辑\n\n")
        giant = analysis.get("giant_object_logic", {})
        f.write(f"- **巨物类型**: {giant.get('types', '')}\n")
        f.write(f"- **尺度参照**: {giant.get('scale_reference', '')}\n")
        f.write(f"- **视觉压迫**: {giant.get('visual_pressure', '')}\n")
        f.write(f"- **人的关系**: {giant.get('human_relationship', '')}\n\n")
        
        # 叙事逻辑
        f.write("## 4. 叙事逻辑\n\n")
        narrative = analysis.get("narrative_logic", {})
        f.write(f"- **故事弧线**: {narrative.get('story_arc', '')}\n")
        f.write(f"- **剪辑节奏**: {narrative.get('editing_rhythm', '')}\n")
        f.write(f"- **视角变化**: {narrative.get('perspective_changes', '')}\n")
        f.write(f"- **情绪曲线**: {narrative.get('emotion_curve', '')}\n\n")
        
        # 关键帧
        f.write("## 5. 关键帧描述\n\n")
        for i, frame in enumerate(analysis.get("key_frames", []), 1):
            f.write(f"### 关键帧 {i}\n\n")
            f.write(f"- **构图**: {frame.get('composition', '')}\n")
            f.write(f"- **科幻元素**: {frame.get('scifi_placement', '')}\n")
            f.write(f"- **光影**: {frame.get('lighting', '')}\n")
            f.write(f"- **运镜**: {frame.get('camera', '')}\n")
            f.write(f"- **氛围**: {frame.get('mood', '')}\n\n")
    
    print(f"✅ 分析报告已保存: {report_path}")
    print(f"\n🎉 完成！所有文件已导出到: {output_dir}")


if __name__ == "__main__":
    main()
