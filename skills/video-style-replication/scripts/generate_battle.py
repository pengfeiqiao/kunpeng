#!/usr/bin/env python3
"""
生成战斗篇九宫格（探索后的战斗场景）
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_battle(ref_image_path):
    """生成战斗篇九宫格"""
    
    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_data = base64.b64encode(f.read()).decode()
    
    prompt = """
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张包含9个分镜头的九宫格故事板图片（3行3列，细线分隔）。

【重要：写实感要求】
按方案C的写实感，**不要动漫感**：
- 皮肤有真实肌理，血迹是半透明物理质感
- 装甲磨损、掉漆是真实物理效果
- 光影是自然柔光漫射，阴影有虚化
- 细节有随机冗余（叶片纹理、泥土颗粒）
- 色彩有环境色干扰，不是纯色
- **不要次表面散射油光，不要硬阴影，不要统一化细节**

【重要：影调参数】
色温：4800K（中性偏暖）
对比度：中低对比度（暗部提亮，高光柔化）
饱和度：中低饱和度（自然色系）
颗粒：8%（轻微胶片颗粒）
暗角：5%（轻微暗角）
**整体通透，不阴郁，充满希望感**

【人物设定】
上半身：
- 白色做旧半护甲（短款露腰设计）
- 边缘掉漆露出银灰色金属
- 缝隙附着苔藓、泥点污渍
- 背部交叉固定：藏刀（深色牦牛角刀柄）+ 登山杖（白色做旧）

下半身：
- **白色做旧机甲百褶裙**（大腿中部）
- **腰头在胯部上方，和装甲留10cm露腰空间**
- 裙摆磨损毛边+泥土污渍
- 白色速干战术裤
- 白色护膝

面部：
- 完全复刻参考图人物的面部特征
- 黑色湿发
- 左脸3cm划痕+血渍
- 额头血点
- 右眼尾淤青
- **战斗时表情坚毅**

【场景设定】
雨崩废土战斗场景：
- 白色废弃城市废墟
- 梅里雪山
- 金色星环残骸
- 科幻建筑残骸
- 紫色野花（战斗中被践踏）
- 尘土飞扬

【敌人设定】
- 类似机械生物（科幻感）
- 灰色金属外壳
- 红色传感器眼睛
- 不要太夸张，保持写实感

【九宫格分镜内容（3x3）】

分镜1（左上）：发现敌人
- 景别：中景，平拍
- 内容：站在废墟中，表情警觉，发现前方敌人
- 环境：白色废弃建筑，地面碎石，远处雪山
- 影调：明亮日间光，紧张氛围
- 叙事：危机出现

分镜2（中上）：拔刀
- 景别：上半身特写，平拍
- 内容：右手拔出藏刀，左手持登山杖
- 环境：废墟背景虚化，聚焦人物动作
- 影调：自然光，金属刀刃反光
- 叙事：准备战斗

分镜3（右上）：闪避
- 景别：全景，侧拍
- 内容：侧身闪避敌人攻击，动作流畅
- 环境：废墟，尘土飞扬，紫色野花
- 影调：动态模糊，运动感
- 叙事：战斗开始

分镜4（左中）：反击
- 景别：中景，平拍
- 内容：挥刀反击，刀刃划过敌人装甲
- 环境：废墟，火花四溅
- 影调：自然光，火花点缀
- 叙事：反击

分镜5（中中）：格挡
- 景别：上半身特写，平拍
- 内容：用登山杖格挡敌人攻击，表情坚毅
- 环境：废墟背景虚化，聚焦人物
- 影调：明亮自然光，紧张表情
- 叙事：防御

分镜6（右中）：战术翻滚
- 景别：全景，俯拍30°
- 内容：战术翻滚躲避，动作专业
- 环境：废墟地面，碎石，尘土
- 影调：动态模糊，运动感
- 叙事：灵活机动

分镜7（左下）：致命一击
- 景别：中景，侧拍
- 内容：藏刀刺入敌人弱点，敌人倒下
- 环境：废墟，尘土飞扬
- 影调：自然光，胜利时刻
- 叙事：关键一击

分镜8（中下）：战后喘息
- 景别：中景，平拍
- 内容：站在倒下的敌人旁，喘息，收刀
- 环境：废墟，梅里雪山背景，金色星环
- 影调：明亮日间光，疲惫但胜利
- 叙事：战斗结束

分镜9（右下）：继续前行
- 景别：远景，背影
- 内容：背影继续朝城市深处前行，雪山和星环在前方
- 环境：白色废弃城市，梅里雪山，金色星环
- 影调：高亮日间，充满希望感
- 叙事：继续探索

【负面提示词】
不要动漫感，不要次表面散射油光，不要硬阴影，不要统一化细节，不要高饱和卡通色彩，不要阴郁氛围，不要压抑感

【布局要求】
3行3列，九宫格布局
每个分镜之间有细线分隔

【总结】
- 写实感：方案C风格，真实肌理，自然光影
- 人物：白色机甲+白色百褶裙+露腰10cm+藏刀+登山杖
- 分镜：9个，从发现敌人到继续前行
- 影调：4800K，中低对比，中低饱和，通透不阴郁
- 环境：雨崩废土战斗，白色废弃城市，雪山，星环
- 动作：专业战术动作，流畅自然
"""
    
    output_path = Path.home() / "Desktop" / "视频复刻" / "战斗篇_九宫格.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("🎨 正在生成战斗篇九宫格...")

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
            "size": "3072x3072"
        },
        timeout=300
    )

    result = response.json()

    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]

        if "b64_json" in image_data:
            img_bytes = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_bytes)
            print(f"✅ 战斗篇九宫格已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"✅ 战斗篇九宫格已保存: {output_path}")
            return output_path

    print(f"❌ 生成失败: {result}")
    return None


if __name__ == "__main__":
    # Usage: python3 generate_battle.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_battle.py <参考图路径>")
        sys.exit(1)
    generate_battle(sys.argv[1])
