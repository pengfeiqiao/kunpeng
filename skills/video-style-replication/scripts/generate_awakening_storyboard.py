#!/usr/bin/env python3
"""
生成苏醒片段分镜（5个分镜）
基于确认的方案
"""
import os
import base64
import requests
from pathlib import Path
import json

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_awakening_storyboard():
    """生成苏醒片段5个分镜"""
    
    # 读取分镜方案
    plan_path = Path.home() / "Desktop" / "视频复刻" / "awakening_storyboard_plan.json"
    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)
    
    # 构建提示词
    prompt = """
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张包含5个分镜头的横排故事板图片（1行5列，细线分隔）。

【重要：CG感要求】
3A游戏级风格化CG渲染，**不要写实感**：
- 材质风格化：皮肤次表面散射效果，血迹半透明渲染，金属高光锐利
- 光影设计感：硬阴影边缘锐利，明暗对比强烈，分层明确
- 细节统一：物体边缘顺滑抗锯齿，无实拍噪点/色散/畸变
- 色彩统一：青绿色调+高饱和装甲对比，无色彩偏移

【重要：影调参数】
色温：5000K（中性偏冷）
对比度：120%（明暗对比强烈）
饱和度：85%（高饱和，强化色彩对比）
颗粒：12%（轻微胶片颗粒，但不要噪点）
泛光：20%（边缘柔光）
暗角：8%（轻微暗角）

【人物设定】
上半身：
- 短款露腰红色机械装甲
- 弧形肩甲，磨损掉漆
- 无标识
- 手臂半机械设计
- 背部交叉两把武士刀

下半身：
- 深灰色做旧百褶裙（大腿中部）
- 腰头在胯部上方，和装甲留10cm露腰空间（关键！）
- 裙摆磨损毛边+泥土污渍
- 短款作战腿套+机械战斗靴

面部：
- 完全复刻参考图人物的面部特征
- 黑色湿发
- 左脸3cm划痕+血渍
- 额头血点
- 右眼尾淤青

【场景设定】
- 雨崩废土丛林
- 紫色小花+杂草
- 远处废墟轮廓
- 薄雾感

【5个分镜内容】

分镜1（左）：脸部大特写
- 景别：脸部占70%，俯拍15°
- 内容：闭眼躺在草丛，黑色湿发粘额头，脸颊血迹，紫色小花瓣落在睫毛
- 细节：脖颈机械项圈泥土，皮肤汗珠反光，杂草贴脸
- 影调：低冷调，微弱天光，阴影青蓝
- 叙事：昏迷脆弱状态

分镜2（中左）：机械手特写
- 景别：手部特写，平拍
- 内容：白色机械手指微动，指尖陷在湿润泥土
- 细节：磨损露出银灰金属，关节缝隙草屑泥粒，指尖带动泥土掉落
- 影调：局部硬光，金属高光锐利，阴影较暗
- 叙事：意识开始苏醒

分镜3（中）：面部近景
- 景别：面部近景，俯拍10°
- 内容：猛睁眼（淡金色义眼），瞳孔收缩，抖落花瓣，看向机械手
- 细节：义眼反光映天空，血迹被汗水冲开，呼吸变快
- 影调：对比提升，主光打亮面部，高光暖、阴影冷
- 叙事：意识完全苏醒，迷茫→警觉

分镜4（中右）：上半身中景
- 景别：上半身中景，平拍微仰5°
- 内容：机械手撑地，腰部发力抬起上半身
- **关键**：完整露出腰腹（短款装甲到肋骨，百褶裙腰头在胯上方，中间10cm露腰）
- 细节：深灰百褶裙裙摆泥土，撑地手压草叶进泥土
- 影调：亮度提升，植被绿色饱和度高，和红色装甲强烈对比
- 叙事：从苏醒转向行动

分镜5（右）：中全景
- 景别：中全景，平拍
- 内容：完全跪坐，左右环顾，手摸机械项圈，表情坚定
- 细节：背后武士刀刀柄露出，百褶裙随转头晃动，腰腹细小擦伤+草屑
- 影调：明亮冷调，远景薄雾，光影通透
- 叙事：完成苏醒，确认环境

【负面提示词】
不要写实感，不要实拍噪点，不要色散，不要畸变，不要杂乱细节，不要色彩偏移，不要统一色调，不要过暗，不要过曝

【布局要求】
1行5列，横向排列，每个分镜之间有细线分隔
整体画幅：5120x1024像素（5:1比例）
每个分镜：1024x1024像素

【总结】
- CG感：风格化、硬光、统一细节、高饱和
- 人物：百褶裙+露腰10cm
- 分镜：5个，从昏迷到完成苏醒
- 影调：冷调通透，对比强烈
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "苏醒片段_5分镜.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成苏醒片段分镜（5个分镜）...")
    print("\n【关键特征】")
    print("  ✓ CG感：风格化、硬光、统一细节、高饱和")
    print("  ✓ 人物：百褶裙+露腰10cm")
    print("  ✓ 分镜：5个（昏迷→微动→苏醒→起身→环顾）")
    print("  ✓ 影调：冷调通透，对比强烈")
    print("  ✓ 参考图：完全复刻面部特征")
    
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
            "size": "5120x1024"  # 5:1比例，1行5列
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
            print(f"\n✅ 苏醒片段分镜已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 苏醒片段分镜已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    print("\n" + "="*80)
    print("【苏醒片段分镜】")
    print("5个分镜，从昏迷到完成苏醒")
    print("="*80 + "\n")
    
    result = generate_awakening_storyboard()
    
    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n这个版本包含：")
        print("  1. 分镜1：脸部大特写（昏迷）")
        print("  2. 分镜2：机械手特写（微动）")
        print("  3. 分镜3：面部近景（苏醒）")
        print("  4. 分镜4：上半身中景（起身，露腰）")
        print("  5. 分镜5：中全景（环顾）")


if __name__ == "__main__":
    main()
