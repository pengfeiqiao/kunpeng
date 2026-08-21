#!/usr/bin/env python3
"""
生成方案3：机械结构化能量光束 + 几何转经筒
16:9画幅 + 轻微油画感
"""
import os
import base64
import requests
from pathlib import Path
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_mechanical_version(ref_image_path):
    """生成机械结构化版本"""

    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_base64 = base64.b64encode(f.read()).decode()

    prompt = """
【核心指令】
参考附件人物形象，完全复刻面部特征，生成一张震撼的单幅画面：女主角在雨崩看到悬浮的巨型转经筒矩阵，能量光束为机械结构。

【重要：使用未来废土风风格 + 轻微油画涂抹感】

**光影系统（4层光影）**：
- 主光层：侧逆日光（5600K暖黄）
- 辅光层：植被反射冷绿环境光（4200K）
- 体积光层：丁达尔光束
- 补光层：暗部弱补光
- 明暗反差：7-8档高反差

**色彩系统**：
- 色温：4800K（暗部+15绿色偏移，亮部保留暖黄）
- 饱和度：低饱和（-18），红色跳色（+16）
- 对比度：全局+22

**质感系统 + 轻微油画涂抹感**：
- 颗粒：+22
- 暗角：+28
- 笔触感：+15%（轻微油画厚涂效果）
- 边缘柔化：+12%（笔触过渡）
- 色彩过渡：+10%（油画混色）

【画面内容】

**主体巨物：几何符号化转经筒矩阵**
- 位置：梅里雪山上空（海拔6000-8000米）
- 数量：数百个巨型转经筒（直径50-100米）
- 排列：螺旋上升排列，形成通天塔结构（总高度10公里）
- **几何抽象化设计**：
  - 形态：简化的完美圆柱体
  - 表面：无真实纹理，只有发光的几何符号（圆形/方形）
  - 材质：纯色块（金色），光滑无磨损
  - 细节：发光的几何符号代替六字真言
  - 顶部和底部：圆形光环

**能量光束：机械结构化实体**
- **机械结构设计**：
  - 形态：金属支架结构（桁架/框架）
  - 表面：金属网格，有锈迹（铁锈色/银灰色）
  - 内部：能量线缆（多股缠绕，蓝色/金色发光）
  - 分段：机械节点（齿轮/轴承）
  - 直径：5-10米

- **材质细节**：
  - 支架表面：真实的锈迹和磨损
  - 线缆：有能量流动的纹理
  - 节点：有机械结构的细节（齿轮/活塞）

- **视觉效果**：
  - 像巨型工程机械
  - 强调工业感和废土感
  - 与转经筒形成机械文明遗迹

**环境场景**：
- 前景：雨崩高山草甸（紫色野花、绿草）
- 中景：彩色经幡阵列（飘动，红/黄/蓝/绿/白）
- 远景：梅里雪山主峰（卡瓦格博，白雪覆盖）
- 天空：淡蓝色，有薄云，丁达尔光束

**人物**：
- 位置：草甸中心，背对镜头，仰视巨物
- 景别：全景（人物占比1-2%，强化巨物感）
- 姿态：站立，微微仰头，震撼凝视
- 服装：完全复刻参考图人物
- 面部：完全复刻参考图人物的面部特征
- 比例：真人比例，无动漫夸张

**构图**：
- 视角：横向广角（24-35mm），强调横向延展
- 画幅：16:9横向（2560x1440）
- 景深：前景（经幡/野花）+ 中景（人物）+ 远景（转经筒+雪山）
- 人物位置：画面下1/3区域，居中或偏左

**氛围**：
- 工业废土 + 几何科幻 + 宗教神圣
- 巨大的尺度对比（人vs巨物）
- 震撼、神秘、敬畏
- 通透不阴郁

【禁止】
- 图片中出现任何文字、字幕、标签
- 强行修改透视比例
- 拉高饱和度、对比度
- 过度磨皮/锐化
- 美化式光影优化
- 动漫化、二次元渲染

【总结】
- 画幅：16:9（2560x1440）
- 风格：未来废土风 + 轻微油画感（+15%）
- 转经筒：几何符号化（抽象）
- 能量光束：机械结构化实体（金属支架+能量线缆）
- 人物：复刻参考图，占比1-2%
- 场景：雨崩草甸+梅里雪山+经幡
- 构图：横向广角，低角度仰拍
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "方案3_机械结构化.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("\n" + "="*80)
    print("【方案3：机械结构化能量光束】")
    print("="*80 + "\n")

    print("🎨 正在生成...")
    print("  ✓ 画幅：16:9（2560x1440）")
    print("  ✓ 转经筒：几何符号化（抽象）")
    print("  ✓ 能量光束：机械结构（金属支架+能量线缆）")
    print("  ✓ 油画感：+15%")
    print("  ✓ 人物占比：1-2%")

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
            "size": "2560x1440"
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
            print(f"\n✅ 方案3已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 方案3已保存: {output_path}")
            return output_path

    print(f"❌ 生成失败: {result}")
    return None


def main():
    # Usage: python3 generate_plan3_mechanical.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_plan3_mechanical.py <参考图路径>")
        sys.exit(1)
    result = generate_mechanical_version(sys.argv[1])
    if result:
        print("\n" + "="*80)
        print("【方案3生成完成】")
        print("="*80)
        print("特点：机械结构化能量光束（金属支架+能量线缆）")


if __name__ == "__main__":
    main()
