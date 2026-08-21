#!/usr/bin/env python3
"""
生成人物测试图
使用参考图复刻人脸，改变服装
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

def generate_image_with_reference(reference_image_path, prompt, output_path):
    """使用参考图生成图片"""
    
    # 读取参考图
    with open(reference_image_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode()
    
    # 构建请求
    # 注意：Gemini 生图 API 可能不支持直接使用参考图
    # 我们需要在提示词中详细描述人物特征
    
    response = requests.post(
        f"{BASE_URL}/images/generations",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-image-2",  # 使用更高质量的模型
            "prompt": prompt,
            "n": 1,
            "size": "1536x1024"  # 3:2 比例
        },
        timeout=300
    )
    
    result = response.json()
    
    if "data" in result and len(result["data"]) > 0:
        image_url = result["data"][0].get("url")
        if image_url:
            # 下载图片
            img_response = requests.get(image_url, timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            return output_url
        else:
            print(f"❌ 未找到图片URL: {result}")
            return None
    else:
        print(f"❌ 生图失败: {result}")
        return None

def main():
    # 参考图路径
    # Usage: python3 generate_character_test.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_character_test.py <参考图路径>")
        sys.exit(1)
    reference_path = Path(sys.argv[1])
    
    if not reference_path.exists():
        print(f"❌ 参考图不存在: {reference_path}")
        return
    
    print(f"📁 参考图: {reference_path}")
    
    # 详细的提示词（描述人物特征）
    prompt = """
电影级画质，超高清摄影作品。

【人物】：
- 亚洲男性，25-30岁
- 面部特征：清晰的下颌线，单眼皮，黑色短发，略带胡茬
- 表情：迷茫、刚苏醒的状态
- 服装：深灰色冲锋衣，黑色徒步裤，登山鞋，背包上挂着藏族经幡碎片

【场景】：
- 云南雨崩森林，杜鹃花丛中
- 前景：紫色杜鹃花、绿色草丛
- 背景：透过针叶林隐约可见梅里雪山
- 光线：斑驳的林间光，冷色调

【科幻元素】：
- 树干表面有隐约的金属光泽和网格纹理
- 地面苔藓发出微弱的青色荧光
- 整体氛围：神秘、探索感

【影调】：
- 色温5200K-6200K，中性偏冷
- S型曲线，中等对比度
- 高光青蓝色，阴影冷青带微绿
- 饱和度75%-85%
- 轻微胶片颗粒感
- 中等锐化，空气感强

【构图】：
- 中景，人物坐在草丛中
- 三分法构图，人物位于画面右侧1/3处
- 留白40%，突出空间感

【运镜】：
- 固定镜头，平视角度
- 电影感，16:9画幅
"""
    
    output_path = Path.home() / "Desktop" / "视频复刻" / "苏醒篇_人物测试.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成测试图...")
    print(f"📝 提示词长度: {len(prompt)} 字符")
    
    result = generate_image_with_reference(reference_path, prompt, str(output_path))
    
    if result:
        print(f"✅ 测试图已保存: {result}")
    else:
        print("❌ 生成失败")

if __name__ == "__main__":
    main()
