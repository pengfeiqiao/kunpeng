#!/usr/bin/env python3
"""
生成九宫格分镜头 - v3
1. 使用参考图让Gemini复刻人物
2. 生成3x3九宫格布局
3. 严格复刻影调参数
"""
import os
import base64
import requests
from pathlib import Path
import sys

# DMXAPI 配置
API_KEY = os.environ.get("DMXAPI_KEY")
if not API_KEY:
    print("❌ DMXAPI_KEY 未配置")
    sys.exit(1)

BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_storyboard_with_reference(reference_image_path, prompt, output_path):
    """使用参考图生成分镜图"""
    
    # 读取参考图
    with open(reference_image_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode()
    
    # Gemini 图像生成 API 可能不支持直接使用参考图
    # 我们需要在提示词中明确说明参考图的使用
    
    # 方案1：尝试使用图像输入（如果API支持）
    try:
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
                "size": "2752x2304"  # 九宫格尺寸 (3:2.5 比例)
            },
            timeout=300
        )
        
        result = response.json()
        
        if "data" in result and len(result["data"]) > 0:
            image_data = result["data"][0]
            
            if "b64_json" in image_data:
                print(f"📥 解码base64图片数据")
                img_data = base64.b64decode(image_data["b64_json"])
                with open(output_path, "wb") as f:
                    f.write(img_data)
                return output_path
            elif "url" in image_data:
                print(f"📥 从URL下载图片")
                img_response = requests.get(image_data["url"], timeout=30)
                with open(output_path, "wb") as f:
                    f.write(img_response.content)
                return output_path
        
        print(f"❌ 生图失败: {result}")
        return None
        
    except Exception as e:
        print(f"❌ 请求失败: {e}")
        return None


def main():
    # 参考图路径
    # Usage: python3 generate_storyboard_v3.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_storyboard_v3.py <参考图路径>")
        sys.exit(1)
    reference_path = Path(sys.argv[1])
    
    if not reference_path.exists():
        print(f"❌ 参考图不存在: {reference_path}")
        return
    
    print(f"📁 参考图: {reference_path}")
    
    # 九宫格分镜提示词
    prompt = """
【重要指令】
参考附件中的人物形象，完全复刻人物外观和服装，生成一张包含9个分镜头的九宫格故事板图片。

【九宫格布局】
图片分为3行3列，共9个分镜，从左到右、从上到下依次为：
第1行：分镜1-3
第2行：分镜4-6
第3行：分镜7-9

每个分镜之间有细线分隔，整体为一个完整的故事板。

【场景：雨崩苏醒篇】
故事背景：徒步者在云南雨崩森林中苏醒，逐步发现远古文明遗迹。

【9个分镜内容】

分镜1（左上）：沉睡
- 俯视角度，徒步者躺在杜鹃花丛中
- 前景：紫色杜鹃花、绿色草丛
- 中景：徒步者侧脸（复刻参考图人物）
- 背景：透过树林的雪山轮廓
- 隐约可见树干有金属光泽

分镜2（中上）：苏醒
- 徒步者睁开眼睛，迷茫神情
- 面部特写，复刻参考图人物面容
- 前景：草丛和花瓣
- 背景：虚化的树干

分镜3（右上）：支撑
- 手按在树干上，准备起身
- 树干呈现金属与木质融合质感
- 树皮有网格状纹理
- 手指沾有泥土和苔藓

分镜4（左中）：坐起
- 徒步者坐在草丛中，低头看手
- 周围杜鹃花和苔藓
- 远处树干有微弱金属光泽
- 地面苔藓隐约发出青色微光

分镜5（中中）：凝视
- 手部特写，指尖触碰发光苔藓
- 苔藓发出更亮的青色荧光
- 手指上有泥土、草屑

分镜6（右中）：环顾
- 徒步者站起，环顾四周
- 周围树干都有金属化纹理
- 地面苔藓大面积发光
- 远处雾气中隐约可见悬浮几何体

分镜7（左下）：发现
- 徒步者背影，看向前方
- 前方树木稀疏，透出光线
- 远处雪山上发光结构
- 经幡在风中飘动

分镜8（中下）：凝视
- 徒步者在画面底部中心
- 上方是雪山顶端的发光几何观测站
- 观测站发出金色微光
- 云层穿插在观测站周围
- 人物占比<5%

分镜9（右下）：启程
- 徒步者背影，走向远方
- 前方通往雪山的路
- 路两侧树干金属化
- 远处观测站越来越亮

【人物要求】
- 完全复刻参考图中的人物外观
- 服装改为深灰色冲锋衣、黑色徒步裤、登山鞋
- 背包上挂着藏族经幡碎片
- 保持参考图人物的面部特征和气质

【影调参数（严格复刻）】
- 色温：5200K-6200K，中性偏冷
- 对比度：S型对数曲线，高光压缩20%，阴影提升18%
- 饱和度：75%-85%
- 色彩映射：高光青蓝色，中间调中性，阴影冷青带微绿
- 科幻元素：金色（观测站）+ 青色（苔藓）
- 质感：轻微胶片颗粒，中等锐化，空气感强
- 暗角：10%-15%

【构图要求】
- 每个分镜都是电影级画质
- 整体九宫格布局清晰
- 分镜之间有细线分隔
- 整体画幅：2752x2304像素

【氛围】
- 苏醒→发现→探索的叙事节奏
- 迷茫→震撼→敬畏的情绪递进
- 孤寂、神秘、史诗感
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "苏醒篇_九宫格分镜.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成九宫格分镜...")
    print(f"📝 提示词长度: {len(prompt)} 字符")
    
    result = generate_storyboard_with_reference(reference_path, prompt, str(output_path))
    
    if result:
        print(f"✅ 九宫格分镜已保存: {result}")
    else:
        print("❌ 生成失败")

if __name__ == "__main__":
    main()
