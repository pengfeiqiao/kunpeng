#!/usr/bin/env python3
"""
和豆包沟通：调整苏醒片段方案
1. 白色机甲
2. 中式器物（适合雨崩）
3. 按方案C的写实感
4. 不要太阴郁
5. 九宫格分镜+环境描述
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def adjust_awakening_plan(video_path, current_path, plan_c_path):
    """调整苏醒片段方案"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取当前版本
    with open(current_path, "rb") as f:
        current_base64 = base64.b64encode(f.read()).decode()
    
    # 读取方案C
    with open(plan_c_path, "rb") as f:
        plan_c_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个专业的影视视觉设计师和分镜师。

【用户反馈】
附件中有：
1. 原视频（未来废土风格）
2. 当前版本（苏醒片段5分镜）
3. 方案C图片

用户对当前版本的反馈：
1. **机甲颜色**：要白色机甲（不是红色）
2. **背后器物**：武士刀换成中式适合雨崩的器物（不是武士刀）
3. **写实感**：当前版本太动漫感太不写实，要按方案C的写实感
4. **氛围**：不要太阴郁
5. **分镜格式**：要九宫格（3x3），不是5个横排
6. **内容**：可以加入一些环境描述

【任务】
请重新设计"苏醒"片段的九宫格分镜方案（3x3，9个分镜）：

1. **人物设定调整**
   - 白色做旧半护甲（不是红色）
   - 背后的器物：换成中式适合雨崩的器物（请设计具体是什么，比如：藏刀、登山杖、转经筒等）
   - 百褶裙+露腰保持
   - 面部特征保持

2. **写实感要求**
   - 分析方案C的写实感特征
   - 如何避免动漫感
   - 如何保持写实但不要太阴郁

3. **九宫格分镜设计（9个分镜）**
   - 3x3布局
   - 苏醒片段（可以从原来的5个分镜扩展到9个）
   - 加入环境描述（雨崩的雪山、森林、经幡等）
   - 不要太阴郁，保持通透感
   - 每个分镜包含：景别、角度、内容、细节、叙事、影调

4. **环境元素**
   - 雨崩特色：雪山、森林、经幡、野花
   - 科幻元素：如何融合
   - 光影氛围：如何保持通透但不阴郁

输出格式：JSON
{
  "character_adjustment": {
    "armor_color": "白色机甲设计",
    "back_item": "中式器物设计（具体是什么）",
    "lower_body": "下半身设计",
    "face": "面部特征"
  },
  "realism_requirements": {
    "plan_c_realism": ["写实感特征1", "写实感特征2", ...],
    "avoid_anime": ["避免动漫感的方法1", "方法2", ...],
    "not_gloomy": ["如何不阴郁的方法1", "方法2", ...]
  },
  "storyboard_3x3": {
    "narrative_arc": "叙事弧线",
    "environment_elements": ["环境元素1", "环境元素2", ...],
    "shots": [
      {
        "shot_number": 1,
        "position": "左上",
        "shot_type": "景别",
        "angle": "角度",
        "content": "内容",
        "environment": "环境描述",
        "details": ["细节1", "细节2", ...],
        "narrative": "叙事",
        "tone": "影调（不阴郁）"
      },
      ...（共9个分镜）
    ]
  },
  "tone_guidance": {
    "overall_tone": "整体影调",
    "color_temp": "色温",
    "contrast": "对比度",
    "saturation": "饱和度",
    "atmosphere": "氛围（不阴郁）"
  }
}

请详细、具体地设计。
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
                "url": f"data:image/jpeg;base64,{current_base64}"
            }
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{plan_c_base64}"
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
    # Usage: python3 adjust_awakening_plan.py <参考视频路径> <当前分镜图路径> <方案C图路径>
    if len(sys.argv) != 4:
        print("Usage: python3 adjust_awakening_plan.py <参考视频路径> <当前分镜图路径> <方案C图路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    current_path = Path(sys.argv[2])
    plan_c_path = Path(sys.argv[3])
    
    print("🔍 正在和豆包沟通，调整苏醒片段方案...")
    print("\n【调整要求】")
    print("  1. 白色机甲（不是红色）")
    print("  2. 背后器物：中式适合雨崩（不是武士刀）")
    print("  3. 按方案C的写实感（不要太动漫）")
    print("  4. 不要太阴郁")
    print("  5. 九宫格分镜（3x3，9个分镜）")
    print("  6. 加入环境描述")
    
    result = adjust_awakening_plan(video_path, current_path, plan_c_path)
    
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
    output_path = output_dir / "awakening_3x3_plan.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 调整方案已保存: {output_path}")
    
    # 打印人物调整
    print("\n" + "="*80)
    print("【人物设定调整】")
    print("="*80)
    
    char = plan.get("character_adjustment", {})
    print(f"\n机甲颜色：\n{char.get('armor_color', '')}")
    print(f"\n背后器物：\n{char.get('back_item', '')}")
    print(f"\n下半身：\n{char.get('lower_body', '')}")
    print(f"\n面部：\n{char.get('face', '')}")
    
    # 打印写实感要求
    print("\n" + "="*80)
    print("【写实感要求】")
    print("="*80)
    
    realism = plan.get("realism_requirements", {})
    
    print("\n方案C的写实感特征：")
    for feat in realism.get("plan_c_realism", []):
        print(f"  ✓ {feat}")
    
    print("\n避免动漫感的方法：")
    for method in realism.get("avoid_anime", []):
        print(f"  → {method}")
    
    print("\n如何不阴郁：")
    for method in realism.get("not_gloomy", []):
        print(f"  → {method}")
    
    # 打印环境元素
    print("\n" + "="*80)
    print("【环境元素】")
    print("="*80)
    
    storyboard = plan.get("storyboard_3x3", {})
    
    print(f"\n叙事弧线：{storyboard.get('narrative_arc', '')}")
    print(f"\n环境元素：")
    for elem in storyboard.get("environment_elements", []):
        print(f"  • {elem}")
    
    # 打印九宫格分镜
    print("\n" + "="*80)
    print("【九宫格分镜设计（3x3）】")
    print("="*80)
    
    for shot in storyboard.get("shots", []):
        print(f"\n{'='*60}")
        print(f"分镜 {shot.get('shot_number', '')}（{shot.get('position', '')}）")
        print(f"{'='*60}")
        print(f"景别：{shot.get('shot_type', '')}")
        print(f"角度：{shot.get('angle', '')}")
        print(f"\n内容：\n{shot.get('content', '')}")
        print(f"\n环境：\n{shot.get('environment', '')}")
        print(f"\n细节：")
        for detail in shot.get("details", []):
            print(f"  • {detail}")
        print(f"\n叙事：{shot.get('narrative', '')}")
        print(f"影调：{shot.get('tone', '')}")
    
    # 打印影调指导
    print("\n" + "="*80)
    print("【影调指导】")
    print("="*80)
    
    tone = plan.get("tone_guidance", {})
    print(f"\n整体影调：{tone.get('overall_tone', '')}")
    print(f"色温：{tone.get('color_temp', '')}")
    print(f"对比度：{tone.get('contrast', '')}")
    print(f"饱和度：{tone.get('saturation', '')}")
    print(f"氛围：{tone.get('atmosphere', '')}")
    
    print("\n" + "="*80)
    print("【方案总结】")
    print("="*80)
    print("\n这是调整后的苏醒片段九宫格分镜方案。")
    print("请确认是否满意，如果需要调整，我会修改。")
    print("\n确认要点：")
    print("  1. 白色机甲设计是否满意？")
    print("  2. 背后器物（中式适合雨崩）是否满意？")
    print("  3. 写实感（不动漫）是否满意？")
    print("  4. 九宫格分镜内容是否满意？")
    print("  5. 环境+光影（不阴郁）是否满意？")
    print("\n确认后我会使用参考图生成图片（不会立即生成）。")


if __name__ == "__main__":
    main()
