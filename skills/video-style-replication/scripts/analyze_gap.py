#!/usr/bin/env python3
"""
使用豆包多模态分析：对比原视频和生成的图片
找出差异和问题
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

# DMXAPI 配置
API_KEY = os.environ.get("DMXAPI_KEY")
if not API_KEY:
    print("❌ DMXAPI_KEY 未配置")
    exit(1)

BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def analyze_video_and_image(video_path, image_path):
    """对比分析视频和图片"""
    
    # 读取视频
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取图片
    with open(image_path, "rb") as f:
        image_base64 = base64.b64encode(f.read()).decode()
    
    # 构建消息
    content = [
        {"type": "text", "text": """
你是一个专业的影视视觉分析师。请分析以下两个内容：

1. 第一个附件是一个短视频（未来废土风格）
2. 第二个附件是一张九宫格分镜图片（声称是复刻该视频风格的）

【任务】
请详细对比分析：

1. **原视频的核心视觉特征**
   - 科幻元素是什么？（具体描述）
   - 影调风格是什么？（色温、对比度、饱和度）
   - 画面构图特点
   - 氛围和情绪

2. **生成图片的视觉特征**
   - 是否有科幻元素？如果有，是什么？
   - 影调风格是什么？
   - 画面构图特点
   - 氛围和情绪

3. **差异分析**
   - 生成图片是否复刻了原视频的科幻元素？
   - 生成图片是否复刻了原视频的影调风格？
   - 生成图片是否复刻了原视频的构图逻辑？
   - 生成图片是否复刻了原视频的氛围？

4. **问题诊断**
   - 如果生成图片与原视频差异很大，问题出在哪里？
   - 是不是根本没有科幻元素？
   - 是不是影调完全不对？
   - 是不是构图逻辑完全不同？

请详细、客观、直白地分析，不要客气，直接指出问题。

输出格式：JSON
{
  "video_analysis": {
    "scifi_elements": "...",
    "tone_style": "...",
    "composition": "...",
    "atmosphere": "..."
  },
  "image_analysis": {
    "scifi_elements": "...",
    "tone_style": "...",
    "composition": "...",
    "atmosphere": "..."
  },
  "gap_analysis": {
    "scifi_gap": "...",
    "tone_gap": "...",
    "composition_gap": "...",
    "atmosphere_gap": "..."
  },
  "problem_diagnosis": {
    "main_problems": ["问题1", "问题2", ...],
    "root_cause": "...",
    "suggestions": ["建议1", "建议2", ...]
  }
}
"""},
        {
            "type": "video_url",
            "video_url": {
                "url": f"data:video/mp4;base64,{video_base64}"
            }
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{image_base64}"
            }
        }
    ]
    
    response = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": content}]
        },
        timeout=180
    )
    
    return response.json()


def main():
    # Usage: python3 analyze_gap.py <参考视频路径> <生成图片路径>
    if len(sys.argv) != 3:
        print("Usage: python3 analyze_gap.py <参考视频路径> <生成图片路径>")
        sys.exit(1)
    video_path = Path(sys.argv[1])
    image_path = Path(sys.argv[2])
    
    if not video_path.exists():
        print(f"❌ 视频不存在: {video_path}")
        return
    
    if not image_path.exists():
        print(f"❌ 图片不存在: {image_path}")
        return
    
    print("🔍 正在对比分析原视频和生成图片...")
    print(f"📁 视频: {video_path}")
    print(f"📁 图片: {image_path}")
    
    result = analyze_video_and_image(video_path, image_path)
    
    if "choices" not in result:
        print(f"❌ 分析失败: {result}")
        return
    
    content = result["choices"][0]["message"]["content"]
    
    # 尝试解析JSON
    try:
        analysis = json.loads(content)
    except json.JSONDecodeError:
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            json_str = content[start:end].strip()
            analysis = json.loads(json_str)
        else:
            print("❌ 无法解析结果")
            print(f"原始内容:\n{content}")
            return
    
    # 保存分析结果
    output_dir = Path.home() / "Desktop" / "视频复刻"
    output_path = output_dir / "gap_analysis.json"
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 分析结果已保存: {output_path}")
    
    # 打印主要问题
    print("\n" + "="*60)
    print("【问题诊断】")
    print("="*60)
    
    problems = analysis.get("problem_diagnosis", {})
    
    print("\n主要问题：")
    for i, problem in enumerate(problems.get("main_problems", []), 1):
        print(f"{i}. {problem}")
    
    print(f"\n根本原因：\n{problems.get('root_cause', '')}")
    
    print("\n改进建议：")
    for i, suggestion in enumerate(problems.get("suggestions", []), 1):
        print(f"{i}. {suggestion}")
    
    print("="*60)


if __name__ == "__main__":
    main()
