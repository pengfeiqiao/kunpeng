#!/usr/bin/env python3
"""
基于平衡分析生成优化版本
方案C影调 + 最终版场景 + 增强细节
"""
import os
import base64
import requests
from pathlib import Path
import json

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_balanced_version():
    """生成平衡版本"""
    
    # 读取改编方案
    plan_path = Path.home() / "Desktop" / "视频复刻" / "adaptation_plan.json"
    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)
    
    # 读取平衡分析
    balance_path = Path.home() / "Desktop" / "视频复刻" / "balance_analysis.json"
    with open(balance_path, "r", encoding="utf-8") as f:
        balance = json.load(f)
    
    # 构建提示词
    prompt = f"""
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张包含9个分镜头的九宫格故事板图片（3行3列，细线分隔）。

【重要：影调要求】
采用方案C的冷白通透影调，**不要过暗影调，不要灰调滤镜，不要暗部死黑，不要丢失纹理细节**。

色温：5000K（中性偏冷，通透）
对比度：115%（明暗层次丰富，暗部不压死，亮部不溢出）
饱和度：80%（自然不艳俗）
颗粒：15%（轻微胶片颗粒）
泛光：20%（边缘柔光）
暗角：10%（轻微暗角，不黑化）

【重要：CG感要求】
3A游戏级次世代CG渲染，写实质感。
- 物体边缘锐利无糊化
- 材质区分度极高（金属、植被、皮肤）
- 全局光照计算均匀
- 有明显的丁达尔体积光效果

【重要：细节要求】
**必须呈现以下细节，不能丢失纹理**：
- 机甲：掉漆、污渍、划痕、磨损纹理
- 植被：叶脉、花瓣纹路、露珠
- 皮肤：血迹、伤口、细微肌理
- 建筑：苔藓、风化痕迹、爬藤
- 手部：布料纹理、皮肤纹理、材质区分
- 金属：反光、湿材质水渍纹理

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

【九宫格分镜内容】

分镜1（左上）：{plan['storyboard_plan'][0]['content']}
叙事：{plan['storyboard_plan'][0]['narrative']}
影调：45°俯拍，冷白通透，保留草甸、经幡、护甲的纹理细节

分镜2（中上）：{plan['storyboard_plan'][1]['content']}
叙事：{plan['storyboard_plan'][1]['narrative']}
影调：特写，清晰呈现护甲掉漆、手指纹理、泥土细节

分镜3（右上）：{plan['storyboard_plan'][2]['content']}
叙事：{plan['storyboard_plan'][2]['narrative']}
影调：平视，展示完整造型，保留裙甲、经幡、无人机细节

分镜4（左中）：{plan['storyboard_plan'][3]['content']}
叙事：{plan['storyboard_plan'][3]['narrative']}
影调：平视，呈现残垣断壁的苔藓、风化痕迹

分镜5（中中）：{plan['storyboard_plan'][4]['content']}
叙事：{plan['storyboard_plan'][4]['narrative']}
影调：仰拍，体积光效果，呈现科研装置、苔藓、经幡细节

分镜6（右中）：{plan['storyboard_plan'][5]['content']}
叙事：{plan['storyboard_plan'][5]['narrative']}
影调：远景，通透感，保留栈道、通讯塔、野花细节

分镜7（左下）：{plan['storyboard_plan'][6]['content']}
叙事：{plan['storyboard_plan'][6]['narrative']}
影调：大远景，突出渺小感，保留飞行器残骸、云层细节

分镜8（中下）：{plan['storyboard_plan'][7]['content']}
叙事：{plan['storyboard_plan'][7]['narrative']}
影调：背面中景，淡蓝微光效果，保留经幡、湖水细节

分镜9（右下）：{plan['storyboard_plan'][8]['content']}
叙事：{plan['storyboard_plan'][8]['narrative']}
影调：全景，光线效果，营造宿命感，保留所有细节

【负面提示词】
不要过暗影调，不要灰调滤镜，不要暗部死黑，不要亮部过曝，不要丢失纹理细节，不要过度降噪，不要过度磨皮，不要模糊材质，不要统一色调

【总结】
- 影调：方案C的冷白通透（5000K，115%对比度，80%饱和度）
- 场景：最终版的雨崩废土设定
- 细节：增强所有纹理（机甲、植被、皮肤、建筑）
- CG感：3A游戏级，材质区分明确
- 胶片感：15%颗粒，10%暗角，20%泛光
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "优化版_平衡方案.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成优化版本：平衡方案...")
    print("\n【关键特征】")
    print("  ✓ 影调：方案C的冷白通透（5000K，115%，80%）")
    print("  ✓ 场景：最终版的雨崩废土设定")
    print("  ✓ 细节：增强所有纹理（机甲、植被、皮肤、建筑）")
    print("  ✓ CG感：3A游戏级，材质区分明确")
    print("  ✓ 胶片感：15%颗粒，20%泛光，10%暗角")
    print("\n【避免问题】")
    print("  ✗ 过暗影调")
    print("  ✗ 灰调滤镜")
    print("  ✗ 暗部死黑")
    print("  ✗ 丢失纹理细节")
    
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
            print(f"\n✅ 优化版本已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 优化版本已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    print("\n" + "="*80)
    print("【优化版本：平衡方案】")
    print("方案C影调 + 最终版场景 + 增强细节")
    print("="*80 + "\n")
    
    result = generate_balanced_version()
    
    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n这个版本应该：")
        print("  1. 保持方案C的冷白通透影调")
        print("  2. 保留最终版的雨崩场景设定")
        print("  3. 增强所有细节纹理")
        print("  4. 避免太过了的问题")


if __name__ == "__main__":
    main()
