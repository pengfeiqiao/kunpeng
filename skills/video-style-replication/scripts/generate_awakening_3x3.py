#!/usr/bin/env python3
"""
生成苏醒片段九宫格分镜（3x3）
基于调整后的方案
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_awakening_3x3(ref_image_path):
    """生成苏醒片段九宫格分镜"""
    
    # 读取分镜方案
    plan_path = Path.home() / "Desktop" / "视频复刻" / "awakening_3x3_plan.json"
    with open(plan_path, "r", encoding="utf-8") as f:
        plan = json.load(f)
    
    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_base64 = base64.b64encode(f.read()).decode()
    
    # 确定输出文件名（自动递增）
    base_dir = Path.home() / "Desktop" / "视频复刻"
    existing_files = list(base_dir.glob("苏醒片段_九宫格_v*.jpg"))
    next_version = len(existing_files) + 3  # v3开始
    output_path = base_dir / f"苏醒片段_九宫格_v{next_version}.jpg"
    
    # 构建提示词
    prompt = f"""
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
雨崩废土环境：
- 紫色野花+高山草甸
- 冷杉林
- 经幡、玛尼堆
- 梅里雪山
- 金色星环残骸
- 科幻拱门残骸（覆满藤蔓）
- **白色废弃雨崩城市废墟**（最后分镜）

【九宫格分镜内容（3x3）】

分镜1（左上）：脸部特写
- 景别：脸部占65%，俯拍20°
- 内容：闭眼躺在紫色野花草甸，湿发粘额头，脸颊血迹
- 环境：紫色野花+杂草，远处冷杉林轮廓
- 细节：脖颈机械项圈泥土，皮肤汗珠，杂草贴脸
- 影调：微弱天光，阴影青蓝但不阴郁
- 叙事：昏迷状态

分镜2（中上）：机械手特写
- 景别：手部占60%，平拍
- 内容：白色机械手指微动，指尖陷在湿润泥土
- 环境：湿润泥土+草叶，远处雪山轮廓
- 细节：磨损露出银灰金属，关节缝隙草屑泥粒
- 影调：自然光，金属反光柔和
- 叙事：意识开始苏醒

分镜3（右上）：面部近景
- 景别：面部近景，俯拍10°
- 内容：睁眼（淡金色义眼），看向机械手
- 环境：杂草前景，雪山背景
- 细节：义眼反光，血迹被汗水冲开
- 影调：日间自然光，通透
- 叙事：意识完全苏醒

分镜4（左中）：撑地中景
- 景别：上半身中景，平拍微仰5°
- 内容：机械手撑地，抬起上半身，**露出腰腹**
- 环境：草甸+经幡，远处森林
- 细节：白色短款装甲到肋骨，白色百褶裙腰头在胯上方，中间10cm露腰
- 影调：明亮日间光，绿色和白色对比
- 叙事：发力起身

分镜5（中中）：坐起中景
- 景别：上半身中景，平拍
- 内容：完全坐起，低头看机械手，背后藏刀+登山杖露出
- 环境：草甸，经幡飘动
- 细节：背后器物轮廓清晰
- 影调：自然光，通透
- 叙事：确认身体状态

分镜6（右中）：跪坐中景
- 景别：中景，平拍
- 内容：跪坐，转头观察环境
- 环境：紫色野花草甸，冷杉林，淡蓝天
- 细节：头发草屑掉落，背后器物固定牢固
- 影调：自然日间光，淡蓝天空提亮
- 叙事：观察陌生环境

分镜7（左下）：站立全景
- 景别：全景，俯拍15°
- 内容：完全站起，拍掉草屑
- 环境：玛尼堆+经幡，紫色野花，冷杉林
- 细节：白色机甲在绿色草甸中视觉突出，玛尼堆纹理清晰
- 影调：明亮日间光，绿色+紫色柔和对比
- 叙事：恢复行动能力

分镜8（中下）：前行远景
- 景别：远景，平拍
- 内容：背影朝森林前行，前方是科幻拱门残骸
- 环境：梅里雪山，金色星环，丁达尔光
- 细节：背后器物轮廓清晰，拱门覆满藤蔓和野花
- 影调：大场景亮调，雪山白+星环金提亮
- 叙事：开始探索

分镜9（右下）：远望大全景
- 景别：大全景，仰拍10°
- 内容：草甸高处，望向**白色废弃雨崩城市废墟**和星环
- 环境：野花草甸，**白色废弃雨崩城市废墟**，金色星环
- 细节：白色机甲在大场景中醒目，城市残骸反射阳光
- 影调：高亮日间，蓝色天空+金色星环，充满希望感
- 叙事：锚定目标

【负面提示词】
不要动漫感，不要次表面散射油光，不要硬阴影，不要统一化细节，不要高饱和卡通色彩，不要阴郁氛围，不要压抑感

【布局要求】
3行3列，九宫格布局
每个分镜之间有细线分隔
整体画幅：3072x3072像素（1:1比例）
每个分镜：1024x1024像素

【总结】
- 写实感：方案C风格，真实肌理，自然光影
- 人物：白色机甲+白色百褶裙+露腰10cm+藏刀+登山杖
- 分镜：9个，从昏迷到开始探索
- 影调：4800K，中低对比，中低饱和，通透不阴郁
- 环境：雨崩废土，经幡，雪山，星环，白色废弃城市
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "苏醒片段_九宫格.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成苏醒片段九宫格分镜（3x3，9个分镜）...")
    print("\n【关键特征】")
    print("  ✓ 写实感：方案C风格，真实肌理，自然光影")
    print("  ✓ 人物：白色机甲+白色百褶裙+露腰10cm+藏刀+登山杖")
    print("  ✓ 分镜：9个（昏迷→苏醒→起身→探索）")
    print("  ✓ 影调：4800K，中低对比，通透不阴郁")
    print("  ✓ 环境：雨崩废土，经幡，雪山，星环，白色废弃城市")
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
            "n": 2,  # 生成2张图片
            "size": "3072x3072"  # 1:1比例，3x3九宫格
        },
        timeout=300  # 增加到5分钟
    )
    
    result = response.json()
    
    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        if "b64_json" in image_data:
            img_data = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_data)
            print(f"\n✅ 苏醒片段九宫格已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 苏醒片段九宫格已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    print("\n" + "="*80)
    print("【苏醒片段九宫格分镜】")
    print("3x3，9个分镜，从昏迷到开始探索")
    print("="*80 + "\n")
    
    # Usage: python3 generate_awakening_3x3.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_awakening_3x3.py <参考图路径>")
        sys.exit(1)
    result = generate_awakening_3x3(sys.argv[1])
    
    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n这个版本包含：")
        print("  1. 分镜1-3：昏迷→微动→苏醒（特写为主）")
        print("  2. 分镜4-6：起身→坐起→跪坐（中景为主）")
        print("  3. 分镜7-9：站立→前行→远望（全景为主）")
        print("\n关键改进：")
        print("  ✓ 白色机甲+白色百褶裙")
        print("  ✓ 藏刀+登山杖（中式适合雨崩）")
        print("  ✓ 方案C写实感（不动漫）")
        print("  ✓ 通透不阴郁的氛围")
        print("  ✓ 参考图人脸复刻")


if __name__ == "__main__":
    main()
