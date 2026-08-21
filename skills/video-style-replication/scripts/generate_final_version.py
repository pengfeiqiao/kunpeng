#!/usr/bin/env python3
"""
基于豆包的改编方案生成最终版本
雨崩废土风格
"""
import os
import base64
import requests
from pathlib import Path
import json

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_final_version():
    """基于改编方案生成最终版本"""
    
    # 读取改编方案
    plan_path = Path.home() / "Desktop" / "视频复刻" / "adaptation_plan.json"
    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)
    
    # 构建提示词
    prompt = f"""
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张包含9个分镜头的九宫格故事板图片（3行3列，细线分隔）。

【人物设定】
{plan['character_design']['upper_armor']}

{plan['character_design']['lower_armor']}

{plan['character_design']['weapons']}

{plan['character_design']['face_details']}

【场景设定】
{plan['scene_design']['yubang_integration']}

科幻元素：
{chr(10).join(['• ' + elem for elem in plan['scene_design']['scifi_elements']])}

{plan['scene_design']['vegetation']}

{plan['scene_design']['terrain']}

【影调参数】
{plan['tone_params']['cg_enhancement']}

{plan['tone_params']['film_enhancement']}

色温：{plan['tone_params']['color_temp']}K
对比度：{plan['tone_params']['contrast']}
饱和度：{plan['tone_params']['saturation']}

【构图逻辑】
镜头角度：{', '.join(plan['composition_logic']['camera_angles'])}

{plan['composition_logic']['human_ratio']}

{plan['composition_logic']['shot_distribution']}

【九宫格分镜内容】

分镜1（左上）：{plan['storyboard_plan'][0]['content']}
叙事：{plan['storyboard_plan'][0]['narrative']}

分镜2（中上）：{plan['storyboard_plan'][1]['content']}
叙事：{plan['storyboard_plan'][1]['narrative']}

分镜3（右上）：{plan['storyboard_plan'][2]['content']}
叙事：{plan['storyboard_plan'][2]['narrative']}

分镜4（左中）：{plan['storyboard_plan'][3]['content']}
叙事：{plan['storyboard_plan'][3]['narrative']}

分镜5（中中）：{plan['storyboard_plan'][4]['content']}
叙事：{plan['storyboard_plan'][4]['narrative']}

分镜6（右中）：{plan['storyboard_plan'][5]['content']}
叙事：{plan['storyboard_plan'][5]['narrative']}

分镜7（左下）：{plan['storyboard_plan'][6]['content']}
叙事：{plan['storyboard_plan'][6]['narrative']}

分镜8（中下）：{plan['storyboard_plan'][7]['content']}
叙事：{plan['storyboard_plan'][7]['narrative']}

分镜9（右下）：{plan['storyboard_plan'][8]['content']}
叙事：{plan['storyboard_plan'][8]['narrative']}

【重要提示】
1. 完全复刻参考图人物的面部特征
2. 下半身必须有白色战术裙甲（不能只有内裤）
3. 场景必须融合雨崩元素（雪山、经幡、村落、冰湖、神瀑）
4. 影调必须有强烈的CG感和胶片感
5. 严格按照9个分镜的内容生成
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "最终版_雨崩废土.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成最终版本：雨崩废土改编...")
    print("\n【关键改进】")
    print("  ✓ 下半身：白色战术裙甲（6片）+ 战术裤 + 护膝")
    print("  ✓ 无N2标识")
    print("  ✓ 场景：雨崩元素融合（雪山、经幡、村落、冰湖、神瀑）")
    print("  ✓ 影调：PBR渲染 + 柯达Portra 400胶片曲线")
    print("  ✓ 质感：10%胶片颗粒 + 12%泛光 + 5%暗角")
    
    response = requests.post(
        f"{BASE_URL}/images/generations",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-image-2",
            "prompt": prompt,
            "n": 1,
            "size": "2752x2304"
        },
        timeout=300
    )
    
    result = response.json()
    
    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]
        
        if "b64_json" in image_data:
            img_data = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_data)
            print(f"\n✅ 最终版本已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 最终版本已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    print("\n" + "="*80)
    print("【最终版本：雨崩废土改编】")
    print("="*80 + "\n")
    
    result = generate_final_version()
    
    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n这是基于豆包详细改编方案生成的版本，解决了：")
        print("  1. 下半身装甲问题（白色战术裙甲）")
        print("  2. 无N2标识")
        print("  3. 雨崩场景融合")
        print("  4. 增强CG感和胶片感")


if __name__ == "__main__":
    main()
