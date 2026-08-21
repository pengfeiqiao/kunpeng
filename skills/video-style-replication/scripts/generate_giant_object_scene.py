#!/usr/bin/env python3
"""
生成方案1：悬浮转经筒矩阵（单图）
使用未来废土风风格 + 参考图人物
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_giant_prayer_wheels(ref_image_path):
    """生成悬浮转经筒矩阵单图"""

    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_base64 = base64.b64encode(f.read()).decode()

    # 构建提示词（基于未来废土风 + 方案1描述）
    prompt = """
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张震撼的单幅画面：女主角在雨崩看到悬浮的巨型转经筒矩阵。

【重要：使用未来废土风风格】

**光影系统（4层光影）**：
- 主光层：侧逆日光（5600K暖黄），打亮人物轮廓与装甲高光
- 辅光层：植被反射冷绿环境光（4200K），填充人物暗部
- 体积光层：丁达尔光束，穿过转经筒间隙形成光柱
- 补光层：暗部弱补光保留细节
- 明暗反差：7-8档高反差，冷暖对比强烈

**色彩系统**：
- 色温：4800K（暗部叠加15单位绿色偏移，亮部保留暖黄）
- 饱和度：低饱和（-18），金色转经筒作为跳色（+16）
- 对比度：全局+22，暗部压暗-18，高光压制-10
- 色相：灰绿、灰蓝、暖黄为主

**质感系统**：
- 颗粒：胶片颗粒强度+22，颗粒大小7，粗糙度18
- 暗角：强度+28，半径65%，柔和度85%
- 锐度：整体偏低，边缘轻微柔化
- 色调：暗部偏冷绿，亮部偏暖黄

**安全增强**：
- 自然随机光斑：+15%（模拟树叶缝隙漏光）
- 暗部透气度：+10%（保留灰阶层次）
- 实拍颗粒感：+8%（模拟胶片噪点）

**谨慎增强**：
- 运动模糊：≤10%（前景经幡飘动）
- 冷暖渐变：≤5%（天空到地面）
- 高光偏移：≤8%（转经筒金属反光）

【画面内容】

**主体巨物：悬浮转经筒矩阵**
- 位置：梅里雪山上空（海拔6000-8000米）
- 数量：数百个巨型转经筒（直径50-100米）
- 排列：螺旋上升排列，形成通天塔结构（总高度10公里）
- 材质：金色金属（表面有磨损、掉漆、苔藓附着）
- 细节：
  - 每个转经筒表面刻满发光的六字真言（金色光芒）
  - 转经筒之间有蓝色能量光束连接，形成网络
  - 转经筒缓慢旋转（通过运动模糊≤10%暗示）
  - 表面有真实的物理磨损（掉漆露出金属底层、锈迹、泥土）
  - 苔藓、藤蔓附着在转经筒底部（废土化）

**环境场景**：
- 前景：雨崩高山草甸（紫色野花、绿草）
- 中景：彩色经幡阵列（飘动，红/黄/蓝/绿/白）
- 远景：梅里雪山主峰（卡瓦格博，白雪覆盖）
- 天空：淡蓝色，有薄云，丁达尔光束穿透

**人物**：
- 位置：草甸中心，背对镜头，仰视转经筒矩阵
- 景别：全景（人物占比3-5%，强化巨物感）
- 姿态：站立，微微仰头，一手遮阳，震撼凝视
- 服装：完全复刻参考图人物
  - 白色做旧半护甲（短款露腰）
  - 白色做旧机甲百褶裙
  - 背部交叉：藏刀+登山杖
  - 黑色湿发
- 面部：完全复刻参考图人物的面部特征
- 比例：真人比例，无动漫夸张

**构图**：
- 视角：低角度仰拍（强化压迫感）
- 景深：前景（经幡/野花）+ 中景（人物）+ 远景（转经筒矩阵）
- 透视：广角透视（20-24mm），强化巨物的尺度感
- 人物位置：画面下1/3区域，居中偏左

**光影细节**：
- 侧逆光打亮转经筒轮廓，形成金色光环
- 丁达尔光束穿过转经筒间隙，照射到地面
- 人物剪影被转经筒的阴影笼罩
- 经幡在前景飘动，有运动模糊（≤10%）
- 转经筒表面的六字真言发光（金色暖光）
- 能量光束连接转经筒（蓝色冷光）

**氛围**：
- 宗教的神圣感 + 科幻的未来感
- 巨大的尺度对比（人vs巨物）
- 震撼、神秘、敬畏
- 通透不阴郁，充满希望感

【禁止调整】
- 强行修改透视比例（必定CG化）
- 拉高饱和度、对比度（必定CG化）
- 过度磨皮/锐化材质（必定CG化）
- 美化式光影优化（失去视频真实感）
- 图片中出现任何文字、字幕、标签

【技术参数】
- 画幅：2048x2048像素（1:1比例）
- 风格：未来废土风（写实感优先）
- 写实要求：
  - 材质符合真实物理属性（金属磨损、苔藓生长）
  - 光影遵循自然规律（散射光、丁达尔效应）
  - 色彩低饱和带灰度
  - 真人比例无动漫夸张
  - 无二次元渲染
  - 无光滑材质
  - 无动漫式描边

【总结】
- 风格：未来废土风（光影+色彩+质感）
- 主体：悬浮转经筒矩阵（数百个，螺旋上升）
- 场景：雨崩草甸 + 梅里雪山
- 人物：复刻参考图，占比3-5%，仰视巨物
- 构图：低角度仰拍，广角透视
- 氛围：宗教神圣+科幻未来，震撼敬畏
- 禁止：CG化、文字、动漫化
"""

    # 确定输出文件名
    output_path = Path.home() / "Desktop" / "视频复刻" / "悬浮转经筒矩阵_单图.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "="*80)
    print("【悬浮转经筒矩阵 - 单图生成】")
    print("风格：未来废土风")
    print("场景：雨崩 + 梅里雪山 + 悬浮转经筒")
    print("="*80 + "\n")

    print("🎨 正在生成悬浮转经筒矩阵单图...")
    print("\n【核心特征】")
    print("  ✓ 风格：未来废土风（光影+色彩+质感）")
    print("  ✓ 巨物：数百个悬浮转经筒（50-100米直径）")
    print("  ✓ 排列：螺旋上升通天塔结构（10公里高）")
    print("  ✓ 细节：发光六字真言+能量光束+真实磨损")
    print("  ✓ 人物：完全复刻参考图，占比3-5%")
    print("  ✓ 场景：雨崩草甸+梅里雪山+经幡")
    print("  ✓ 构图：低角度仰拍，广角透视")
    print("  ✓ 氛围：宗教神圣+科幻未来，震撼敬畏")
    print("  ✗ 禁止：CG化、文字、动漫化")

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
            "size": "2048x2048"
        },
        timeout=600
    )

    result = response.json()

    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]

        if "b64_json" in image_data:
            img_data = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_data)
            print(f"\n✅ 悬浮转经筒矩阵单图已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 悬浮转经筒矩阵单图已保存: {output_path}")
            return output_path

    print(f"❌ 生成失败: {result}")
    return None


def main():
    # Usage: python3 generate_giant_object_scene.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_giant_object_scene.py <参考图路径>")
        sys.exit(1)
    result = generate_giant_prayer_wheels(sys.argv[1])

    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n画面特点：")
        print("  1. 风格：未来废土风（4层光影+低饱和+胶片颗粒）")
        print("  2. 巨物：数百个悬浮转经筒（螺旋上升10公里）")
        print("  3. 细节：发光真言+能量光束+真实磨损")
        print("  4. 人物：复刻参考图，占比3-5%，强化巨物感")
        print("  5. 场景：雨崩草甸+梅里雪山+经幡")
        print("  6. 构图：低角度仰拍，广角透视")
        print("  7. 氛围：宗教神圣+科幻未来")


if __name__ == "__main__":
    main()
