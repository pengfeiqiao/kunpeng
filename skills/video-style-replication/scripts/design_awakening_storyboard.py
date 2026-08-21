#!/usr/bin/env python3
"""
和豆包沟通：
1. 分析方案C的CG感特征
2. 设计"苏醒"片段的详细分镜
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def analyze_cg_and_design_storyboard(video_path, plan_c_path, optimized_path):
    """分析CG感并设计分镜"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取方案C
    with open(plan_c_path, "rb") as f:
        plan_c_base64 = base64.b64encode(f.read()).decode()
    
    # 读取优化版
    with open(optimized_path, "rb") as f:
        optimized_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个专业的影视视觉设计师和分镜师。

【任务1：分析方案C的CG感】
附件中有：
1. 原视频（未来废土风格）
2. 方案C图片
3. 优化版图片

用户反馈：优化版还可以，但希望再往方案C的CG感靠一点。

请详细分析：
- 方案C的CG感具体好在哪里？（具体特征，不是概括）
- 优化版和方案C相比，CG感差在哪里？
- 如何让优化版更接近方案C的CG感？（具体调整建议）

【任务2：设计"苏醒"片段的详细分镜】
用户要求：
- 只做"苏醒"这个片段的分镜
- 把苏醒部分做丰富点（不要只有1-2个分镜，可能需要4-6个）
- 其他分镜不用做
- 人物穿百褶裙，但腰可以露出来

请设计"苏醒"片段的详细分镜（4-6个分镜），包括：
1. 每个分镜的景别、角度、构图
2. 每个分镜的具体内容（人物动作、环境细节）
3. 每个分镜的叙事逻辑（情绪递进）
4. 每个分镜的影调要求

参考原视频的"苏醒"部分：
- 主角躺在草丛中
- 面部特写（苏醒）
- 机械手特写
- 挣扎起身
- 环顾四周

但需要更丰富、更细节化。

输出格式：JSON
{
  "cg_analysis": {
    "plan_c_cg_features": ["特征1", "特征2", ...],
    "optimized_gap": ["差距1", "差距2", ...],
    "adjustment_suggestions": ["建议1", "建议2", ...]
  },
  "awakening_storyboard": {
    "narrative_arc": "苏醒片段的整体叙事弧线",
    "shot_count": 分镜数量,
    "shots": [
      {
        "shot_number": 1,
        "shot_type": "景别",
        "angle": "角度",
        "composition": "构图",
        "content": "具体内容",
        "details": ["细节1", "细节2", ...],
        "narrative": "叙事逻辑",
        "tone": "影调要求"
      },
      ...
    ]
  },
  "character_adjustment": {
    "upper_body": "上半身设计",
    "lower_body": "下半身设计（百褶裙+露腰）",
    "key_details": ["关键细节1", "关键细节2", ...]
  }
}

请非常详细、非常具体地设计。
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
                "url": f"data:image/jpeg;base64,{optimized_base64}"
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
    # Usage: python3 design_awakening_storyboard.py <参考视频路径> <方案C图路径> <优化版图路径>
    if len(sys.argv) != 4:
        print("Usage: python3 design_awakening_storyboard.py <参考视频路径> <方案C图路径> <优化版图路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    plan_c_path = Path(sys.argv[2])
    optimized_path = Path(sys.argv[3])
    
    print("🔍 正在和豆包沟通：CG感分析 + 苏醒分镜设计...")
    
    result = analyze_cg_and_design_storyboard(video_path, plan_c_path, optimized_path)
    
    if "choices" not in result:
        print(f"❌ 失败: {result}")
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
    output_path = output_dir / "awakening_storyboard_plan.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 方案已保存: {output_path}")
    
    # 打印CG分析
    print("\n" + "="*80)
    print("【方案C的CG感特征】")
    print("="*80)
    
    cg = analysis.get("cg_analysis", {})
    
    print("\n方案C的CG感特征：")
    for feat in cg.get("plan_c_cg_features", []):
        print(f"  ✓ {feat}")
    
    print("\n优化版的差距：")
    for gap in cg.get("optimized_gap", []):
        print(f"  ❌ {gap}")
    
    print("\n调整建议：")
    for sug in cg.get("adjustment_suggestions", []):
        print(f"  → {sug}")
    
    # 打印人物调整
    print("\n" + "="*80)
    print("【人物调整】")
    print("="*80)
    
    char = analysis.get("character_adjustment", {})
    print(f"\n上半身：\n{char.get('upper_body', '')}")
    print(f"\n下半身：\n{char.get('lower_body', '')}")
    print(f"\n关键细节：")
    for detail in char.get("key_details", []):
        print(f"  • {detail}")
    
    # 打印分镜设计
    print("\n" + "="*80)
    print("【苏醒片段分镜设计】")
    print("="*80)
    
    storyboard = analysis.get("awakening_storyboard", {})
    print(f"\n叙事弧线：{storyboard.get('narrative_arc', '')}")
    print(f"分镜数量：{storyboard.get('shot_count', 0)}个")
    
    for shot in storyboard.get("shots", []):
        print(f"\n{'='*60}")
        print(f"分镜 {shot.get('shot_number', '')}")
        print(f"{'='*60}")
        print(f"景别：{shot.get('shot_type', '')}")
        print(f"角度：{shot.get('angle', '')}")
        print(f"构图：{shot.get('composition', '')}")
        print(f"\n内容：\n{shot.get('content', '')}")
        print(f"\n细节：")
        for detail in shot.get("details", []):
            print(f"  • {detail}")
        print(f"\n叙事：{shot.get('narrative', '')}")
        print(f"影调：{shot.get('tone', '')}")
    
    print("\n" + "="*80)
    print("【方案总结】")
    print("="*80)
    print("\n这是豆包设计的'苏醒'片段详细分镜方案。")
    print("请确认是否满意，如果需要调整，我会修改后再生图。")
    print("\n确认要点：")
    print("  1. CG感调整方向是否正确？")
    print("  2. 人物设定（百褶裙+露腰）是否满意？")
    print("  3. 苏醒片段的分镜数量和内容是否满意？")
    print("  4. 是否需要调整某些分镜的细节？")
    print("\n确认后我会使用参考图生成图片。")


if __name__ == "__main__":
    main()
