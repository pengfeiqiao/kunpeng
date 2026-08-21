#!/usr/bin/env python3
"""
和豆包沟通：原视频 + 方案C + 最终版
找出最佳平衡点
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def analyze_three_versions(video_path, plan_c_path, final_path):
    """对比分析三个版本"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取方案C
    with open(plan_c_path, "rb") as f:
        plan_c_base64 = base64.b64encode(f.read()).decode()
    
    # 读取最终版
    with open(final_path, "rb") as f:
        final_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个非常专业的影视视觉分析师。请分析以下四个内容：

1. 第一个附件：原视频（未来废土风格参考）
2. 第二个附件：方案C图片
3. 第三个附件：最终版图片

【用户反馈】
- 更喜欢方案C的影调和CG感
- 最终版的影调"太过了"
- 最终版缺少细节
- 需要保持方案C的影调 + 最终版的场景设定 + 增强细节

【任务】
请详细分析：

1. **方案C的优点**
   - 影调好在哪里？（具体参数）
   - CG感好在哪里？（具体特征）
   - 质感好在哪里？（具体细节）

2. **最终版的问题**
   - 影调为什么"太过了"？（具体指出）
   - 缺少哪些细节？（具体指出）
   - 哪些地方过度处理了？

3. **原视频的核心特征**
   - 影调的具体参数（色温、对比度、饱和度）
   - CG感的具体表现
   - 胶片感的具体表现
   - 细节的具体特征

4. **最佳平衡方案**
   - 如何保持方案C的影调？
   - 如何融合最终版的场景设定？
   - 如何增强细节？
   - 具体的参数建议

5. **改进建议**
   - 提示词应该如何调整？
   - 哪些参数应该保持？
   - 哪些参数应该降低？
   - 哪些细节应该增加？

输出格式：JSON
{
  "plan_c_advantages": {
    "tone": "影调优点",
    "cg_feeling": "CG感优点",
    "texture": "质感优点"
  },
  "final_version_issues": {
    "tone_problems": ["问题1", "问题2", ...],
    "missing_details": ["细节1", "细节2", ...],
    "over_processing": ["过度1", "过度2", ...]
  },
  "video_core_features": {
    "tone_params": {
      "color_temp": "具体数值",
      "contrast": "具体描述",
      "saturation": "具体数值"
    },
    "cg_features": ["特征1", "特征2", ...],
    "film_features": ["特征1", "特征2", ...],
    "detail_features": ["特征1", "特征2", ...]
  },
  "balanced_solution": {
    "tone_strategy": "如何保持方案C影调",
    "scene_strategy": "如何融合场景设定",
    "detail_strategy": "如何增强细节",
    "parameters": {
      "color_temp": "数值",
      "contrast": "数值",
      "saturation": "数值",
      "grain": "数值",
      "bloom": "数值",
      "vignette": "数值"
    }
  },
  "improvement_suggestions": {
    "prompt_adjustments": ["调整1", "调整2", ...],
    "keep_parameters": ["参数1", "参数2", ...],
    "reduce_parameters": ["参数1", "参数2", ...],
    "add_details": ["细节1", "细节2", ...]
  }
}

请非常具体、非常详细地分析。
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
                "url": f"data:image/jpeg;base64,{plan_c_base64}"
            }
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{final_base64}"
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
    # Usage: python3 analyze_balance.py <参考视频路径> <方案C图路径> <最终版图路径>
    if len(sys.argv) != 4:
        print("Usage: python3 analyze_balance.py <参考视频路径> <方案C图路径> <最终版图路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    plan_c_path = Path(sys.argv[2])
    final_path = Path(sys.argv[3])
    
    print("🔍 正在对比分析：原视频 + 方案C + 最终版...")
    
    result = analyze_three_versions(video_path, plan_c_path, final_path)
    
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
    output_path = output_dir / "balance_analysis.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 分析结果已保存: {output_path}")
    
    # 打印分析结果
    print("\n" + "="*80)
    print("【方案C的优点】")
    print("="*80)
    
    plan_c = analysis.get("plan_c_advantages", {})
    print(f"\n影调优点：\n{plan_c.get('tone', '')}")
    print(f"\nCG感优点：\n{plan_c.get('cg_feeling', '')}")
    print(f"\n质感优点：\n{plan_c.get('texture', '')}")
    
    # 打印最终版的问题
    print("\n" + "="*80)
    print("【最终版的问题】")
    print("="*80)
    
    final = analysis.get("final_version_issues", {})
    
    print("\n影调问题：")
    for prob in final.get("tone_problems", []):
        print(f"  ❌ {prob}")
    
    print("\n缺少的细节：")
    for detail in final.get("missing_details", []):
        print(f"  ❌ {detail}")
    
    print("\n过度处理的地方：")
    for over in final.get("over_processing", []):
        print(f"  ⚠️  {over}")
    
    # 打印原视频核心特征
    print("\n" + "="*80)
    print("【原视频核心特征】")
    print("="*80)
    
    video = analysis.get("video_core_features", {})
    tone = video.get("tone_params", {})
    print(f"\n影调参数：")
    print(f"  • 色温：{tone.get('color_temp', '')}")
    print(f"  • 对比度：{tone.get('contrast', '')}")
    print(f"  • 饱和度：{tone.get('saturation', '')}")
    
    print(f"\nCG感特征：")
    for feat in video.get("cg_features", []):
        print(f"  • {feat}")
    
    print(f"\n胶片感特征：")
    for feat in video.get("film_features", []):
        print(f"  • {feat}")
    
    print(f"\n细节特征：")
    for feat in video.get("detail_features", []):
        print(f"  • {feat}")
    
    # 打印平衡方案
    print("\n" + "="*80)
    print("【最佳平衡方案】")
    print("="*80)
    
    balance = analysis.get("balanced_solution", {})
    print(f"\n影调策略：\n{balance.get('tone_strategy', '')}")
    print(f"\n场景策略：\n{balance.get('scene_strategy', '')}")
    print(f"\n细节策略：\n{balance.get('detail_strategy', '')}")
    
    params = balance.get("parameters", {})
    print(f"\n推荐参数：")
    print(f"  • 色温：{params.get('color_temp', '')}")
    print(f"  • 对比度：{params.get('contrast', '')}")
    print(f"  • 饱和度：{params.get('saturation', '')}")
    print(f"  • 颗粒：{params.get('grain', '')}")
    print(f"  • 泛光：{params.get('bloom', '')}")
    print(f"  • 暗角：{params.get('vignette', '')}")
    
    # 打印改进建议
    print("\n" + "="*80)
    print("【改进建议】")
    print("="*80)
    
    improve = analysis.get("improvement_suggestions", {})
    
    print("\n提示词调整：")
    for i, adj in enumerate(improve.get("prompt_adjustments", []), 1):
        print(f"{i}. {adj}")
    
    print("\n保持的参数：")
    for param in improve.get("keep_parameters", []):
        print(f"  ✓ {param}")
    
    print("\n降低的参数：")
    for param in improve.get("reduce_parameters", []):
        print(f"  ↓ {param}")
    
    print("\n增加的细节：")
    for detail in improve.get("add_details", []):
        print(f"  + {detail}")
    
    print("\n" + "="*80)


if __name__ == "__main__":
    main()
