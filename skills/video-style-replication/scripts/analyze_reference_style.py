#!/usr/bin/env python3
"""
让豆包深度分析3月4日.png的视觉效果
重点关注：油画质感、巨物构图感、画幅比例
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def analyze_reference_style(ref_image_path, current_image_path):
    """分析参考图的视觉风格"""

    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_base64 = base64.b64encode(f.read()).decode()

    # 读取当前生成图
    current_image_path = Path(current_image_path)
    with open(current_image_path, "rb") as f:
        current_image_base64 = base64.b64encode(f.read()).decode()

    prompt = """
你是专业的视觉风格分析师。请深度分析这张参考图（3月4日.png）的视觉效果，重点分析：

**1. 画幅比例**
- 这张图的实际画幅比例是多少？（请精确测量）
- 是16:9、21:9还是其他比例？
- 横向延展感是如何营造的？

**2. 油画质感**
- 油画涂抹感的具体表现是什么？
- 笔触感、边缘柔化、色彩过渡的强度如何？
- 这种油画感是如何与写实感平衡的？
- 油画感主要体现在哪些地方（巨物？环境？人物？）

**3. 巨物构图感**
- 巨物在画面中的占比是多少？
- 巨物的位置和透视是如何设计的？
- 人物占比是多少？如何强化巨物感？
- 画面的景深层次是如何安排的？

**4. 视觉氛围**
- 整体的视觉氛围是什么？
- 光影、色彩、质感如何配合营造氛围？
- 有哪些独特的视觉特征？

**5. 与当前生成的对比**
- 当前生成的图（方案4_生物化实体.jpg）与参考图的差距在哪里？
- 需要调整哪些参数才能更接近参考图的视觉效果？

**输出格式（JSON）**：
{
  "画幅比例": {
    "实际比例": "例如：21:9",
    "横向延展感": "描述",
    "构图特点": "描述"
  },
  "油画质感": {
    "笔触感强度": "具体百分比或描述",
    "边缘柔化程度": "具体描述",
    "色彩过渡方式": "描述",
    "油画感位置": ["巨物", "环境", "人物"],
    "写实平衡": "如何平衡油画感和写实感"
  },
  "巨物构图感": {
    "巨物占比": "百分比",
    "巨物位置": "描述",
    "人物占比": "百分比",
    "景深层次": "描述",
    "透视设计": "描述"
  },
  "视觉氛围": {
    "整体氛围": "描述",
    "光影特点": "描述",
    "色彩特点": "描述",
    "质感特点": "描述"
  },
  "优化建议": {
    "画幅调整": "具体建议",
    "油画感调整": "具体建议（强度、位置、方式）",
    "构图调整": "具体建议",
    "氛围调整": "具体建议",
    "关键参数": {
      "画幅比例": "具体数值",
      "油画笔触感": "具体百分比",
      "巨物占比": "具体百分比",
      "人物占比": "具体百分比"
    }
  }
}
"""

    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{ref_image_base64}"}
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{current_image_base64}"}
        }
    ]

    print("🔍 正在深度分析参考图的视觉风格...")
    print("   重点：画幅比例、油画质感、巨物构图感\n")

    response = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": content}]
        },
        timeout=180
    )

    result = response.json()

    if "choices" in result and len(result["choices"]) > 0:
        analysis_text = result["choices"][0]["message"]["content"]

        # 提取JSON
        try:
            json_start = analysis_text.find("{")
            json_end = analysis_text.rfind("}") + 1
            json_str = analysis_text[json_start:json_end]
            analysis = json.loads(json_str)
        except:
            analysis = {"raw_analysis": analysis_text}

        # 保存分析结果
        output_path = Path.home() / "Desktop" / "视频复刻" / "reference_style_analysis.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)

        print("✅ 分析完成！\n")

        # 打印关键发现
        if "画幅比例" in analysis:
            print("="*80)
            print("【画幅比例分析】")
            print("="*80)
            for key, value in analysis["画幅比例"].items():
                print(f"  {key}: {value}")

        if "油画质感" in analysis:
            print("\n" + "="*80)
            print("【油画质感分析】")
            print("="*80)
            for key, value in analysis["油画质感"].items():
                if isinstance(value, list):
                    print(f"  {key}: {', '.join(value)}")
                else:
                    print(f"  {key}: {value}")

        if "巨物构图感" in analysis:
            print("\n" + "="*80)
            print("【巨物构图感分析】")
            print("="*80)
            for key, value in analysis["巨物构图感"].items():
                print(f"  {key}: {value}")

        if "视觉氛围" in analysis:
            print("\n" + "="*80)
            print("【视觉氛围分析】")
            print("="*80)
            for key, value in analysis["视觉氛围"].items():
                print(f"  {key}: {value}")

        if "优化建议" in analysis:
            print("\n" + "="*80)
            print("【优化建议】")
            print("="*80)
            
            if "关键参数" in analysis["优化建议"]:
                print("\n关键参数调整：")
                for key, value in analysis["优化建议"]["关键参数"].items():
                    print(f"  • {key}: {value}")
            
            for key, value in analysis["优化建议"].items():
                if key != "关键参数":
                    print(f"\n{key}: {value}")

        print(f"\n📁 详细分析已保存: {output_path}")

        return analysis
    else:
        print(f"❌ 分析失败: {result}")
        return None


def main():
    print("\n" + "="*80)
    print("【深度分析：3月4日.png的视觉风格】")
    print("重点：画幅比例、油画质感、巨物构图感")
    print("="*80 + "\n")

    # Usage: python3 analyze_reference_style.py <参考图路径> <当前生成图路径>
    if len(sys.argv) != 3:
        print("Usage: python3 analyze_reference_style.py <参考图路径> <当前生成图路径>")
        sys.exit(1)
    analyze_reference_style(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
