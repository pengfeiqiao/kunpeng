#!/usr/bin/env python3
"""
豆包多模态API分析 - BV1XeJEz6Ex9地理特效视频
"""

import os
import sys
import base64
import requests
import json
from pathlib import Path
import time

# DMXAPI多模态配置
DMXAPI_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions"
DMXAPI_KEY = os.environ.get("DMXAPI_KEY") or os.environ.get("BANANA_API_KEY")
if not DMXAPI_KEY:
    sys.exit("请设置环境变量 DMXAPI_KEY（或 BANANA_API_KEY）后再运行")
MODEL_NAME = "doubao-seed-2-0-pro-260215"

def encode_image(image_path):
    """编码图片为Base64"""
    with open(image_path, 'rb') as f:
        image_data = f.read()
        print(f"    图片大小: {len(image_data) / 1024:.1f} KB")
        return base64.b64encode(image_data).decode('utf-8')

def analyze_single_frame(frame_path):
    """分析单张帧（独立函数，用于并行处理）"""
    frame_name = frame_path.name
    print(f"  分析 {frame_name}...")

    try:
        base64_image = encode_image(frame_path)

        headers = {
            "Content-Type": "application/json",
            "Authorization": DMXAPI_KEY
        }

        payload = {
            "model": MODEL_NAME,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": """请从以下维度分析这张视频帧的地理特效视觉风格，以JSON格式返回：

1. camera: 运镜方式（航拍俯视/固定机位/动态跟拍/特写/广角等）
2. composition: 构图特点（三分法/曲线构图/中心构图/框架构图等）
3. color: 色彩风格（冷色调/暖色调/冷暖对比/低饱和度/高对比度等）
4. effects: 地理特效（地貌特效/水系特效/植被特效/云雾特效/光影特效/等）
5. summary: 一句话总结该帧的视觉特征和地理特效

请严格按以下JSON格式返回（不要包含其他文字）：
{
  "camera": "运镜方式描述",
  "composition": "构图特点描述",
  "color": "色彩风格描述",
  "effects": "地理特效描述",
  "summary": "一句话总结"
}
"""
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.7,
            "max_tokens": 600
        }

        response = requests.post(DMXAPI_URL, json=payload, headers=headers, timeout=180)
        response.raise_for_status()

        result = response.json()

        if 'choices' in result and len(result['choices']) > 0:
            content = result['choices'][0]['message']['content']

            try:
                json_start = content.find('{')
                json_end = content.rfind('}') + 1
                if json_start != -1 and json_end > json_start:
                    json_str = content[json_start:json_end]
                    analysis = json.loads(json_str)
                    return {
                        "frame": frame_name,
                        "analysis": analysis,
                        "success": True
                    }
            except json.JSONDecodeError:
                pass

        return {
            "frame": frame_name,
            "error": "解析失败",
            "success": False
        }

    except Exception as e:
        return {
            "frame": frame_name,
            "error": str(e),
            "success": False
        }

def analyze_video_frames_batch(frames_dir, output_json, batch_size=5):
    """分批分析视频帧（避免超时）"""
    # 选择有代表性的帧（每10帧一帧）
    all_frames = sorted(Path(frames_dir).glob("frame_*.jpg"))
    selected_frames = all_frames[::10]  # 每10帧选择1帧

    print(f"📸 总帧数: {len(all_frames)}")
    print(f"🎯 选择分析帧数: {len(selected_frames)} (每10帧一帧)")
    print(f"🤖 使用模型: {MODEL_NAME}")
    print(f"🔑 API: {DMXAPI_URL}")
    print(f"📦 每批分析: {batch_size}帧")
    print()

    all_results = []

    # 分批处理
    for batch_start in range(0, len(selected_frames), batch_size):
        batch_end = min(batch_start + batch_size, len(selected_frames))
        batch = selected_frames[batch_start:batch_end]

        print(f"📦 批次 {batch_start//batch_size + 1}: 帧索引 {batch_start}-{batch_end}")

        batch_results = []
        for frame_path in batch:
            result = analyze_single_frame(frame_path)

            if result.get("success"):
                all_results.append(result)
                batch_results.append(result)
                print(f"    ✅ {result['analysis'].get('summary', '')}")
            else:
                print(f"    ❌ {result.get('error', '未知错误')}")

            # 批内延迟
            time.sleep(1)

        print(f"    批次完成: {len(batch_results)}/{len(batch)}")
        print()

        # 批次间延迟
        if batch_end < len(selected_frames):
            print("    等待5秒后开始下一批次...")
            time.sleep(5)

    # 保存结果
    output_data = {
        "video_id": "BV1XeJEz6Ex9",
        "video_title": "待定",
        "model": MODEL_NAME,
        "total_frames": len(all_frames),
        "selected_frames": len(selected_frames),
        "successful_analyses": len(all_results),
        "analyses": all_results
    }

    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 分析完成！{len(all_results)}/{len(selected_frames)}")
    print(f"📁 结果已保存: {output_json}")

    # 打印风格总结
    print_style_summary(all_results)

    return output_data

def print_style_summary(results):
    """打印风格总结"""
    if not results:
        return

    print("\n" + "=" * 60)
    print("📊 地理特效视觉风格总结（豆包多模态分析）")
    print("=" * 60)

    cameras = [r['analysis']['camera'] for r in results]
    colors = [r['analysis']['color'] for r in results]
    compositions = [r['analysis']['composition'] for r in results]
    effects = [r['analysis']['effects'] for r in results]

    camera_counts = {}
    for c in cameras:
        camera_counts[c] = camera_counts.get(c, 0) + 1

    print("\n运镜方式分布：")
    for camera, count in sorted(camera_counts.items(), key=lambda x: x[1], reverse=True):
        percentage = count / len(results) * 100
        print(f"  - {camera}: {count}帧 ({percentage:.1f}%)")

    color_counts = {}
    for c in colors:
        color_counts[c] = color_counts.get(c, 0) + 1
    print("\n色彩风格分布：")
    for color, count in sorted(color_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
        percentage = count / len(results) * 100
        print(f"  - {color}: {count}帧 ({percentage:.1f}%)")

    comp_counts = {}
    for c in compositions:
        comp_counts[c] = comp_counts.get(c, 0) + 1
    print("\n构图特点分布：")
    for comp, count in sorted(comp_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
        percentage = count / len(results) * 100
        print(f"  - {comp}: {count}帧 ({percentage:.1f}%)")

    effect_counts = {}
    for e in effects:
        effect_counts[e] = effect_counts.get(e, 0) + 1
    print("\n地理特效分布：")
    for effect, count in sorted(effect_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
        percentage = count / len(results) * 100
        print(f"  - {effect}: {count}帧 ({percentage:.1f}%)")

    print("=" * 60)

if __name__ == "__main__":
    # Usage: python3 analyze_geography_BV1XeJEz6Ex9.py <抽帧目录> <输出json路径> [batch_size]
    if len(sys.argv) < 3:
        print("Usage: python3 analyze_geography_BV1XeJEz6Ex9.py <抽帧目录> <输出json路径> [batch_size]")
        sys.exit(1)
    frames_dir = sys.argv[1]
    output_json = sys.argv[2]
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 5

    analyze_video_frames_batch(frames_dir, output_json, batch_size=batch_size)
