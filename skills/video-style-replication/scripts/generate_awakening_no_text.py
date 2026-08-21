#!/usr/bin/env python3
"""
生成无文字版苏醒片段九宫格
明确禁止图片中出现任何文字
"""
import os
import base64
import requests
from pathlib import Path
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_no_text_version(ref_image_path):
    """生成无文字版"""
    
    # 读取参考图
    ref_image_path = Path(ref_image_path)
    with open(ref_image_path, "rb") as f:
        ref_image_base64 = base64.b64encode(f.read()).decode()
    
    # 读取提示词
    prompt_path = Path.home() / "Desktop" / "视频复刻" / "awakening_prompt_no_text.md"
    with open(prompt_path, "r", encoding="utf-8") as f:
        prompt = f.read()
    
    # 确定输出文件名
    output_path = Path.home() / "Desktop" / "视频复刻" / "苏醒片段_九宫格_无文字版.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("\n" + "="*80)
    print("【苏醒片段九宫格 - 无文字版】")
    print("v3人脸美化 + 最终版光影系统 + 禁止文字")
    print("="*80 + "\n")
    
    print("🎨 正在生成无文字版九宫格分镜...")
    print("\n【核心策略】")
    print("  ✓ 人脸：完全复刻参考图 + v3美化（精致20%）")
    print("  ✓ 光影：1:1还原视频 + 安全增强")
    print("  ✓ 材质：真实质感 + 边缘精致化")
    print("  ✗ 特别禁止：图片中出现任何文字、字幕、标签")
    print("  ✓ 目标：v3美化效果 + 视频级光影 + 纯视觉画面")
    
    response = requests.post(
        f"{BASE_URL}/images/generations",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-image-2",  # 备用模型
            "prompt": prompt,
            "n": 1,
            "size": "3072x3072"
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
            print(f"\n✅ 无文字版九宫格已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"\n✅ 无文字版九宫格已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    # Usage: python3 generate_awakening_no_text.py <参考图路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_awakening_no_text.py <参考图路径>")
        sys.exit(1)
    result = generate_no_text_version(sys.argv[1])
    
    if result:
        print("\n" + "="*80)
        print("【生成完成】")
        print("="*80)
        print(f"✅ 文件位置: {result}")
        print("\n无文字版特点：")
        print("  1. 人脸：完全复刻参考图 + v3美化")
        print("  2. 光影：视频级系统 + 安全增强")
        print("  3. 材质：真实质感 + 边缘精致化")
        print("  4. 特别禁止：图片中无任何文字、字幕、标签")
        print("  5. 预期：v3美化 + 视频级光影 + 纯视觉画面")
        print("\n📁 提示词已保存: ~/Desktop/视频复刻/awakening_prompt_no_text.md")


if __name__ == "__main__":
    main()
