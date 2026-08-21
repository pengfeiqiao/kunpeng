#!/usr/bin/env python3
"""
生成探索篇九宫格（苏醒片段的后续）
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_exploration(ref_image_path):
    """生成探索篇九宫格"""
    
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

【场景设定】
雨崩废土探索场景：
- 紫色野花+高山草甸
- 冷杉林
- 经幡、玛尼堆
- 梅里雪山
- 金色星环残骸
- 科幻拱门残骸（覆满藤蔓）
- 白色废弃雨崩城市废墟
- 山间小路
- 倒塌的经幡柱

【九宫格分镜内容（3x3）】

分镜1（左上）：穿越花海
- 景别：全景，侧拍
- 内容：背影穿过紫色野花海，朝向白色废弃城市
- 环境：紫色野花海，远处白色城市轮廓，雪山背景
- 影调：明亮日间光，紫色+白色柔和对比
- 叙事：开始探索之旅

分镜2（中上）：经过经幡
- 景别：中景，平拍
- 内容：侧身经过倒塌的经幡柱，伸手触碰
- 环境：经幡柱，玛尼堆，冷杉林
- 影调：自然光，经幡色彩点缀
- 叙事：感受废土文明遗迹

分镜3（右上）：发现遗迹
- 景别：中景，俯拍15°
- 内容：蹲下查看地面上的科幻碎片，捡起一块
- 环境：草甸，科幻碎片散落，远处森林
- 影调：明亮自然光，金属碎片反光
- 叙事：发现线索

分镜4（左中）：进入森林
- 景别：远景，平拍
- 内容：背影走进冷杉林，光影斑驳
- 环境：冷杉林，丁达尔光束，地面落叶
- 影调：林间光斑，明暗对比但柔和
- 叙事：深入探索

分镜5（中中）：穿越拱门
- 景别：全景，仰拍20°
- 内容：站在科幻拱门下，仰视拱门结构
- 环境：覆满藤蔓的科幻拱门，梅里雪山背景
- 影调：自然光，藤蔓绿色+金属银灰
- 叙事：科幻元素出现

分镜6（右中）：眺望雪山
- 景别：中景，侧拍
- 内容：站在高处，眺望梅里雪山和金色星环
- 环境：山脊，梅里雪山，金色星环残骸
- 影调：大场景亮调，雪山白+星环金
- 叙事：感受宏大场景

分镜7（左下）：接近城市
- 景别：远景，俯拍15°
- 内容：背影接近白色废弃城市废墟
- 环境：草甸，白色城市废墟，雪山背景
- 影调：明亮日间光，白色建筑+绿色草地
- 叙事：目标临近

分镜8（中下）：进入废墟
- 景别：中景，平拍
- 内容：侧身走进白色废弃建筑，观察周围
- 环境：白色废弃建筑内部，坍塌的墙壁，藤蔓
- 影调：室内柔光，窗户光束
- 叙事：进入核心区域

分镜9（右下）：发现中心
- 景别：大全景，俯拍30°
- 内容：站在废墟中心广场，四周是白色废弃建筑
- 环境：白色废弃城市广场，梅里雪山，金色星环
- 影调：高亮日间，蓝色天空+白色建筑+金色星环
- 叙事：到达目的地

【负面提示词】
不要动漫感，不要次表面散射油光，不要硬阴影，不要统一化细节，不要高饱和卡通色彩，不要阴郁氛围，不要压抑感

【布局要求】
3行3列，九宫格布局
每个分镜之间有细线分隔

【总结】
- 写实感：方案C风格，真实肌理，自然光影
- 人物：白色机甲+白色百褶裙+露腰10cm+藏刀+登山杖
- 分镜：9个，从穿越花海到进入废墟
- 影调：4800K，中低对比，中低饱和，通透不阴郁
- 环境：雨崩废土探索，经幡，雪山，星环，白色废弃城市
"""
    
    output_path = Path.home() / "Desktop" / "视频复刻" / "探索篇_九宫格.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("🎨 正在生成探索篇九宫格...")

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
            print(f"✅ 探索篇九宫格已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"✅ 探索篇九宫格已保存: {output_path}")
            return output_path

    print(f"❌ 生成失败: {result}")
    return None


if __name__ == "__main__":
    # Usage: python3 generate_exploration.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_exploration.py <参考图路径>")
        sys.exit(1)
    generate_exploration(sys.argv[1])
