#!/usr/bin/env python3
"""
和豆包沟通，制定改编方案
风格类似原视频，但元素基于雨崩做融合改造
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def create_adaptation_plan(video_path):
    """制定改编方案"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个专业的影视视觉设计师。现在要制定一个"改编方案"（不是复刻）。

【参考素材】
附件是一个未来废土风格的视频，我们要参考它的风格，但改编成雨崩版本。

【改编需求】
1. **人物设定**：
   - 东亚少女（已确定）
   - 白色做旧半护甲（上半身）
   - **问题**：现在下半身只有内裤，需要设计白色风格的下装甲
   - 不需要N2标识

2. **场景设定**：
   - 基于云南雨崩做融合
   - 不是完全照搬原视频的遗迹
   - 需要做改造（雨崩元素+废土风格）

3. **影调质感**：
   - 现在游戏CG感和胶片感有点弱
   - 需要更接近原视频的质感

【任务】
请制定一个详细的"雨崩废土改编方案"，包括：

1. **人物设计**：
   - 上半身装甲的具体设计（白色做旧）
   - 下半身装甲的具体设计（不能只有内裤，要白色风格，与上半身协调）
   - 武器、配饰的设计
   - 面部特征（血渍、伤痕等）

2. **场景设计**：
   - 如何将雨崩元素（雪山、森林、村落、冰湖、神瀑、经幡）融合废土风格
   - 需要哪些科幻/遗迹元素（不照搬原视频，但要类似风格）
   - 植被、地貌的具体设计

3. **影调参数**：
   - 如何增强游戏CG感（具体参数）
   - 如何增强胶片感（具体参数）
   - 色温、对比度、饱和度的具体数值

4. **构图逻辑**：
   - 镜头角度的安排
   - 人物占比的控制
   - 景别的分布

5. **九宫格分镜规划**：
   - 9个分镜的具体内容
   - 每个分镜的叙事逻辑

输出格式：JSON
{
  "character_design": {
    "upper_armor": "具体描述",
    "lower_armor": "具体描述（重点！）",
    "weapons": "具体描述",
    "face_details": "具体描述"
  },
  "scene_design": {
    "yubang_integration": "雨崩元素如何融合",
    "scifi_elements": ["科幻元素1", "科幻元素2", ...],
    "vegetation": "植被设计",
    "terrain": "地貌设计"
  },
  "tone_params": {
    "cg_enhancement": "如何增强CG感",
    "film_enhancement": "如何增强胶片感",
    "color_temp": "具体数值",
    "contrast": "具体数值",
    "saturation": "具体数值"
  },
  "composition_logic": {
    "camera_angles": ["角度1", "角度2", ...],
    "human_ratio": "占比逻辑",
    "shot_distribution": "景别分布"
  },
  "storyboard_plan": [
    {
      "shot_number": 1,
      "content": "具体内容",
      "narrative": "叙事逻辑"
    },
    ...
  ]
}

请详细、具体地描述，让我可以基于这个方案生成图片。
"""},
        {
            "type": "video_url",
            "video_url": {
                "url": f"data:video/mp4;base64,{video_base64}"
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
    # Usage: python3 create_adaptation_plan.py <参考视频路径>
    if len(sys.argv) != 2:
        print("Usage: python3 create_adaptation_plan.py <参考视频路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    
    print("🎨 正在和豆包沟通，制定雨崩废土改编方案...")
    
    result = create_adaptation_plan(video_path)
    
    if "choices" not in result:
        print(f"❌ 失败: {result}")
        return
    
    content = result["choices"][0]["message"]["content"]
    
    # 解析JSON
    try:
        plan = json.loads(content)
    except json.JSONDecodeError:
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            json_str = content[start:end].strip()
            plan = json.loads(json_str)
        else:
            print("❌ 无法解析结果")
            print(f"原始内容:\n{content}")
            return
    
    # 保存方案
    output_dir = Path.home() / "Desktop" / "视频复刻"
    output_path = output_dir / "adaptation_plan.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 改编方案已保存: {output_path}")
    
    # 打印方案
    print("\n" + "="*80)
    print("【雨崩废土改编方案】")
    print("="*80)
    
    # 人物设计
    char = plan.get("character_design", {})
    print("\n【人物设计】")
    print(f"上半身装甲：\n{char.get('upper_armor', '')}")
    print(f"\n下半身装甲：\n{char.get('lower_armor', '')}")
    print(f"\n武器：\n{char.get('weapons', '')}")
    print(f"\n面部细节：\n{char.get('face_details', '')}")
    
    # 场景设计
    scene = plan.get("scene_design", {})
    print("\n" + "="*80)
    print("【场景设计】")
    print(f"\n雨崩融合：\n{scene.get('yubang_integration', '')}")
    print(f"\n科幻元素：")
    for elem in scene.get("scifi_elements", []):
        print(f"  • {elem}")
    print(f"\n植被：\n{scene.get('vegetation', '')}")
    print(f"\n地貌：\n{scene.get('terrain', '')}")
    
    # 影调参数
    tone = plan.get("tone_params", {})
    print("\n" + "="*80)
    print("【影调参数】")
    print(f"\n增强CG感：\n{tone.get('cg_enhancement', '')}")
    print(f"\n增强胶片感：\n{tone.get('film_enhancement', '')}")
    print(f"\n色温：{tone.get('color_temp', '')}")
    print(f"对比度：{tone.get('contrast', '')}")
    print(f"饱和度：{tone.get('saturation', '')}")
    
    # 构图逻辑
    comp = plan.get("composition_logic", {})
    print("\n" + "="*80)
    print("【构图逻辑】")
    print(f"\n镜头角度：{', '.join(comp.get('camera_angles', []))}")
    print(f"\n人物占比：{comp.get('human_ratio', '')}")
    print(f"\n景别分布：{comp.get('shot_distribution', '')}")
    
    # 分镜规划
    print("\n" + "="*80)
    print("【九宫格分镜规划】")
    for shot in plan.get("storyboard_plan", []):
        print(f"\n分镜{shot.get('shot_number', '')}：")
        print(f"  内容：{shot.get('content', '')}")
        print(f"  叙事：{shot.get('narrative', '')}")
    
    print("\n" + "="*80)


if __name__ == "__main__":
    main()
