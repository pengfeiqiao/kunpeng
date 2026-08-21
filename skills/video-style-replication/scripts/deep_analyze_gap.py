#!/usr/bin/env python3
"""
使用豆包多模态对比分析：原视频 vs 方案A vs 方案B
找出具体的巨大差异
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def analyze_three_sources(video_path, image_a_path, image_b_path):
    """对比分析三个内容"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取图片A
    with open(image_a_path, "rb") as f:
        image_a_base64 = base64.b64encode(f.read()).decode()
    
    # 读取图片B
    with open(image_b_path, "rb") as f:
        image_b_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个非常严格、非常直接的影视视觉分析师。请分析以下三个内容：

1. 第一个附件：原视频（未来废土风格参考）
2. 第二个附件：方案A图片（声称复刻原视频）
3. 第三个附件：方案B图片（声称复刻原视频）

【任务】
请非常直白、非常具体地分析：

## 1. 原视频的核心视觉DNA
列出原视频的**所有**核心视觉特征，包括：
- 具体的科幻元素（不要概括，要具体描述）
- 具体的影调参数（色温、对比度、饱和度的具体数值范围）
- 具体的构图逻辑（人物占比、镜头角度、景别分布）
- 具质的质感（颗粒、锐化、通透度）
- 具体的氛围（情绪关键词）

## 2. 方案A的具体问题
逐项对比，指出：
- 哪些科幻元素缺失或错误？
- 影调哪里不对？（具体到色温、对比度、饱和度）
- 构图哪里不对？（具体到人物占比、镜头角度）
- 质感哪里不对？
- 氛围哪里不对？

## 3. 方案B的具体问题
逐项对比，指出：
- 哪些科幻元素缺失或错误？
- 影调哪里不对？（具体到色温、对比度、饱和度）
- 构图哪里不对？（具体到人物占比、镜头角度）
- 质感哪里不对？
- 氛围哪里不对？

## 4. 根本问题诊断
- 为什么两张图都和原视频差别"特别特别特别巨大"？
- 是不是根本没有理解原视频的核心特征？
- 是不是提示词写得太抽象，没有具体参数？
- 是不是Gemini生图API本身无法复刻这种风格？

## 5. 具体改进方案
给出非常具体的、可操作的改进建议：
- 提示词应该如何修改？（具体到每个参数）
- 是否需要换用其他生图模型？
- 是否需要分步生成？

请**非常直白**，**非常具体**，**不要客气**，直接指出所有问题。

输出格式：JSON
{
  "video_dna": {
    "scifi_elements": ["具体元素1", "具体元素2", ...],
    "tone_params": {
      "color_temp": "具体数值",
      "contrast": "具体描述",
      "saturation": "具体数值",
      "color_mapping": "具体描述"
    },
    "composition": {
      "human_ratio": "具体占比",
      "camera_angles": ["具体角度1", "具体角度2", ...],
      "shot_types": ["具体景别1", "具体景别2", ...]
    },
    "texture": {
      "grain": "具体描述",
      "sharpness": "具体描述",
      "clarity": "具体描述"
    },
    "atmosphere": ["关键词1", "关键词2", ...]
  },
  "plan_a_issues": {
    "scifi_problems": ["问题1", "问题2", ...],
    "tone_problems": ["问题1", "问题2", ...],
    "composition_problems": ["问题1", "问题2", ...],
    "texture_problems": ["问题1", "问题2", ...],
    "atmosphere_problems": ["问题1", "问题2", ...]
  },
  "plan_b_issues": {
    "scifi_problems": ["问题1", "问题2", ...],
    "tone_problems": ["问题1", "问题2", ...],
    "composition_problems": ["问题1", "问题2", ...],
    "texture_problems": ["问题1", "问题2", ...],
    "atmosphere_problems": ["问题1", "问题2", ...]
  },
  "root_cause": {
    "why_huge_gap": "根本原因",
    "misunderstanding": ["误解1", "误解2", ...],
    "technical_limits": ["限制1", "限制2", ...]
  },
  "improvement_plan": {
    "prompt_changes": ["修改1", "修改2", ...],
    "model_suggestions": ["建议1", "建议2", ...],
    "workflow_changes": ["改变1", "改变2", ...]
  }
}
"""},
        {
            "type": "video_url",
            "video_url": {
                "url": f"data:video/mp4;base64,{video_base64}"
            }
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{image_a_base64}"
            }
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{image_b_base64}"
            }
        }
    ]
    
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
    
    return response.json()


def main():
    # Usage: python3 deep_analyze_gap.py <参考视频路径> <方案A图路径> <方案B图路径>
    if len(sys.argv) != 4:
        print("Usage: python3 deep_analyze_gap.py <参考视频路径> <方案A图路径> <方案B图路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    image_a_path = Path(sys.argv[2])
    image_b_path = Path(sys.argv[3])
    
    print("🔍 正在对比分析：原视频 vs 方案A vs 方案B...")
    
    result = analyze_three_sources(video_path, image_a_path, image_b_path)
    
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
    
    # 保存分析结果
    output_dir = Path.home() / "Desktop" / "视频复刻"
    output_path = output_dir / "deep_gap_analysis.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 分析结果已保存: {output_path}")
    
    # 打印关键问题
    print("\n" + "="*80)
    print("【原视频核心DNA】")
    print("="*80)
    
    video_dna = analysis.get("video_dna", {})
    
    print("\n科幻元素：")
    for elem in video_dna.get("scifi_elements", []):
        print(f"  • {elem}")
    
    print("\n影调参数：")
    tone = video_dna.get("tone_params", {})
    print(f"  • 色温: {tone.get('color_temp', '')}")
    print(f"  • 对比度: {tone.get('contrast', '')}")
    print(f"  • 饱和度: {tone.get('saturation', '')}")
    print(f"  • 色彩映射: {tone.get('color_mapping', '')}")
    
    print("\n构图逻辑：")
    comp = video_dna.get("composition", {})
    print(f"  • 人物占比: {comp.get('human_ratio', '')}")
    print(f"  • 镜头角度: {', '.join(comp.get('camera_angles', []))}")
    print(f"  • 景别: {', '.join(comp.get('shot_types', []))}")
    
    print("\n质感：")
    texture = video_dna.get("texture", {})
    print(f"  • 颗粒: {texture.get('grain', '')}")
    print(f"  • 锐化: {texture.get('sharpness', '')}")
    print(f"  • 通透度: {texture.get('clarity', '')}")
    
    print("\n氛围：")
    print(f"  {', '.join(video_dna.get('atmosphere', []))}")
    
    # 打印方案A的问题
    print("\n" + "="*80)
    print("【方案A的具体问题】")
    print("="*80)
    
    plan_a = analysis.get("plan_a_issues", {})
    
    print("\n科幻元素问题：")
    for prob in plan_a.get("scifi_problems", []):
        print(f"  ❌ {prob}")
    
    print("\n影调问题：")
    for prob in plan_a.get("tone_problems", []):
        print(f"  ❌ {prob}")
    
    print("\n构图问题：")
    for prob in plan_a.get("composition_problems", []):
        print(f"  ❌ {prob}")
    
    # 打印方案B的问题
    print("\n" + "="*80)
    print("【方案B的具体问题】")
    print("="*80)
    
    plan_b = analysis.get("plan_b_issues", {})
    
    print("\n科幻元素问题：")
    for prob in plan_b.get("scifi_problems", []):
        print(f"  ❌ {prob}")
    
    print("\n影调问题：")
    for prob in plan_b.get("tone_problems", []):
        print(f"  ❌ {prob}")
    
    print("\n构图问题：")
    for prob in plan_b.get("composition_problems", []):
        print(f"  ❌ {prob}")
    
    # 打印根本原因
    print("\n" + "="*80)
    print("【根本问题诊断】")
    print("="*80)
    
    root_cause = analysis.get("root_cause", {})
    
    print(f"\n为什么差别巨大：\n{root_cause.get('why_huge_gap', '')}")
    
    print("\n误解：")
    for mis in root_cause.get("misunderstanding", []):
        print(f"  • {mis}")
    
    print("\n技术限制：")
    for limit in root_cause.get("technical_limits", []):
        print(f"  • {limit}")
    
    # 打印改进方案
    print("\n" + "="*80)
    print("【具体改进方案】")
    print("="*80)
    
    improvement = analysis.get("improvement_plan", {})
    
    print("\n提示词修改：")
    for i, change in enumerate(improvement.get("prompt_changes", []), 1):
        print(f"{i}. {change}")
    
    print("\n模型建议：")
    for i, sug in enumerate(improvement.get("model_suggestions", []), 1):
        print(f"{i}. {sug}")
    
    print("\n工作流改变：")
    for i, change in enumerate(improvement.get("workflow_changes", []), 1):
        print(f"{i}. {change}")
    
    print("="*80)


if __name__ == "__main__":
    main()
