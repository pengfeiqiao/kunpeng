#!/usr/bin/env python3
"""
地理图片分析器
使用豆包多模态API（通过DMXAPI）分析生成的地理图片，检测地理问题并优化提示词

使用方法:
  python geography_analyzer.py --image ./output/geo_epic-cold_xxx.png --prompt "原始提示词"
  python geography_analyzer.py --image ./output/geo_epic-cold_xxx.png --prompt "原始提示词" --optimize

参数:
  --image: 生成的图片路径（必填）
  --prompt: 原始提示词（必填）
  --optimize: 是否生成优化后的提示词（可选）
  --api-key: DMXAPI Key（可从环境变量 DMXAPI_KEY 读取）
"""

import argparse
import base64
import json
import os
import sys
import requests
from datetime import datetime

# DMXAPI 配置
DMXAPI_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions"
DEFAULT_MODEL = "doubao-seed-2-0-pro-260215"  # 豆包多模态模型


# 地理分析系统提示词
GEOGRAPHY_ANALYSIS_SYSTEM_PROMPT = """你是一位专业的地理学家和地质学家，擅长分析地理图片中的地形、地貌、植被、气候等特征。

你的任务是分析用户提供的地理图片，检查以下可能的地理问题：

1. **地形真实性**
   - 山脉走向是否符合地质构造规律
   - 等高线是否合理（密集处坡陡，稀疏处坡缓）
   - 山峰形态是否符合真实地貌
   - 海拔数据是否合理

2. **气候与植被**
   - 植被类型是否与海拔、气候匹配
   - 雪线高度是否合理
   - 积雪分布是否符合季节和地形

3. **地质特征**
   - 岩石类型是否与地质背景一致
   - 沟壑、河谷形态是否自然
   - 地质层理是否合理

4. **标注准确性**
   - 海拔数据是否与真实数据接近
   - 地名标注是否正确
   - 比例尺是否合理

5. **视觉一致性**
   - 光影方向是否一致
   - 色调是否符合地理环境
   - 透视关系是否正确

请用中文回复，输出格式为JSON：
{
  "overall_score": <1-10分，整体地理准确性评分>,
  "issues": [
    {
      "category": "<问题类别>",
      "description": "<问题描述>",
      "severity": "<严重程度: 低/中/高>"
    }
  ],
  "strengths": ["<优点1>", "<优点2>"],
  "suggestions": ["<改进建议1>", "<改进建议2>"]
}

如果用户请求优化提示词，还需要添加：
{
  "optimized_prompt": "<优化后的提示词，保持原有风格但修正地理问题>"
}
"""


def encode_image_to_base64(image_path):
    """将图片编码为Base64"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_image_mime_type(image_path):
    """获取图片的MIME类型"""
    ext = os.path.splitext(image_path)[1].lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp"
    }
    return mime_types.get(ext, "image/png")


def analyze_geography_image(image_path, prompt, api_key, model=DEFAULT_MODEL, optimize=False):
    """
    使用豆包API分析地理图片（通过DMXAPI）
    
    Args:
        image_path: 图片路径
        prompt: 原始提示词
        api_key: DMXAPI Key
        model: 模型名称
        optimize: 是否生成优化后的提示词
    
    Returns:
        分析结果字典
    """
    print("=" * 60)
    print("🔍 开始地理图片分析...")
    print("=" * 60)
    print(f"📷 图片: {image_path}")
    print(f"📝 原始提示词: {prompt[:100]}..." if len(prompt) > 100 else f"📝 原始提示词: {prompt}")
    print(f"🤖 模型: {model}")
    print("=" * 60)
    
    # 编码图片
    print("📤 正在编码图片...")
    image_base64 = encode_image_to_base64(image_path)
    image_mime = get_image_mime_type(image_path)
    print(f"✓ 图片编码完成 ({len(image_base64) // 1024} KB)")
    
    # 构建用户消息
    user_content = f"""请分析这张地理图片的准确性。

原始生成提示词：
{prompt}

请检查图片中的地理问题，包括地形真实性、气候与植被、地质特征、标注准确性、视觉一致性等方面。"""

    if optimize:
        user_content += """

请同时提供优化后的提示词，保持原有的地理视频风格（epic-cold/vitality/seasonal-hybrid/mixed），但修正可能存在的地理问题。"""

    # 构建请求数据
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": GEOGRAPHY_ANALYSIS_SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{image_mime};base64,{image_base64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": user_content
                    }
                ]
            }
        ],
        "temperature": 0.3,
        "max_tokens": 4096
    }
    
    # 请求头
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "DMXAPI/1.0.0 (https://www.dmxapi.com/)"
    }
    
    # 调用API
    print("📡 正在调用豆包多模态API...")
    try:
        response = requests.post(
            DMXAPI_URL,
            headers=headers,
            json=payload,
            timeout=300
        )
        
        if response.status_code != 200:
            print(f"❌ API调用失败: HTTP {response.status_code}")
            print(f"响应: {response.text[:500]}")
            return None
        
        result = response.json()
        response_text = result["choices"][0]["message"]["content"]
        print("✓ API调用成功")
        
    except Exception as e:
        print(f"❌ API调用失败: {e}")
        return None
    
    # 解析JSON响应
    print("📊 正在解析分析结果...")
    try:
        # 尝试提取JSON部分
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            result = json.loads(json_str)
        else:
            # 如果没有找到JSON，直接解析
            result = json.loads(response_text)
        
        print("✓ 解析成功")
        
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON解析失败，返回原始文本: {e}")
        result = {
            "raw_response": response_text,
            "parse_error": str(e)
        }
    
    # 打印分析结果
    print("=" * 60)
    print("📋 分析结果")
    print("=" * 60)
    
    if "overall_score" in result:
        score = result["overall_score"]
        print(f"🎯 整体评分: {score}/10")
        
        if "issues" in result and result["issues"]:
            print("\n⚠️ 发现的问题:")
            for issue in result["issues"]:
                severity = issue.get("severity", "未知")
                category = issue.get("category", "未知")
                description = issue.get("description", "")
                severity_icon = {"高": "🔴", "中": "🟡", "低": "🟢"}.get(severity, "⚪")
                print(f"  {severity_icon} [{category}] {description} ({severity})")
        
        if "strengths" in result and result["strengths"]:
            print("\n✅ 优点:")
            for strength in result["strengths"]:
                print(f"  ✓ {strength}")
        
        if "suggestions" in result and result["suggestions"]:
            print("\n💡 改进建议:")
            for suggestion in result["suggestions"]:
                print(f"  • {suggestion}")
        
        if "optimized_prompt" in result:
            print("\n🔧 优化后的提示词:")
            print("-" * 60)
            print(result["optimized_prompt"])
            print("-" * 60)
    
    else:
        print(response_text[:2000])
    
    print("=" * 60)
    
    return result


def save_analysis_result(image_path, result, output_dir="./output"):
    """保存分析结果"""
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    image_basename = os.path.splitext(os.path.basename(image_path))[0]
    output_file = os.path.join(output_dir, f"{image_basename}_analysis_{timestamp}.json")
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"✓ 分析结果已保存: {output_file}")
    return output_file


def main():
    parser = argparse.ArgumentParser(
        description="使用豆包多模态API分析地理图片（通过DMXAPI）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  # 分析图片
  python geography_analyzer.py --image ./output/geo_epic-cold_xxx.png --prompt "贡嘎雪山"

  # 分析并生成优化提示词
  python geography_analyzer.py --image ./output/geo_epic-cold_xxx.png --prompt "贡嘎雪山" --optimize

环境变量：
  DMXAPI_KEY: DMXAPI Key（与 BANANA_API_KEY 相同）
        """
    )
    
    parser.add_argument("--image", required=True, help="图片路径")
    parser.add_argument("--prompt", required=True, help="原始生成提示词")
    parser.add_argument("--optimize", action="store_true", help="生成优化后的提示词")
    parser.add_argument("--output", default="./output", help="输出目录（默认：./output）")
    parser.add_argument("--api-key", 
                       default=os.environ.get("DMXAPI_KEY") or os.environ.get("BANANA_API_KEY"),
                       help="DMXAPI Key")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="模型名称")
    
    args = parser.parse_args()
    
    # 检查必需参数
    if not args.api_key:
        print("❌ 错误：未提供 DMXAPI Key")
        print("   请使用 --api-key 参数或设置环境变量 DMXAPI_KEY")
        return 1
    
    if not os.path.exists(args.image):
        print(f"❌ 错误：图片不存在: {args.image}")
        return 1
    
    # 执行分析
    result = analyze_geography_image(
        image_path=args.image,
        prompt=args.prompt,
        api_key=args.api_key,
        model=args.model,
        optimize=args.optimize
    )
    
    if result:
        # 保存结果
        save_analysis_result(args.image, result, args.output)
        return 0
    else:
        return 1


if __name__ == "__main__":
    sys.exit(main())
