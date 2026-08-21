#!/usr/bin/env python3
"""
地理视频风格图片生成器
使用 DMXAPI Gemini 3.1 Flash Image Preview 生成符合地理视频风格的图片

使用方法:
  python generate_geography_image.py "香格里拉的高山湖泊" --style epic-cold --output ./output

参数:
  prompt: 图片描述（必填）
  --style: 风格选择（epic-cold / vitality / seasonal-hybrid / mixed，默认：epic-cold）
  --aspect-ratio: 宽高比（16:9 / 9:16 / 1:1，默认：16:9）
  --size: 分辨率（1K / 2K / 4K，默认：2K）
  --output: 输出目录（默认：./output）
  --api-key: DMXAPI Key（可从环境变量 DMMXAPI_KEY 读取）

API 文档: https://doc.dmxapi.cn/img-nano-banana.html
"""

import requests
import base64
import os
import argparse
from datetime import datetime
import json

# 默认配置（使用 DMXAPI 代理访问 GPT-Image-2）
_DMXAPI_BASE = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn")
DEFAULT_API_URL = f"{_DMXAPI_BASE}/v1/images/generations"
DEFAULT_MODEL = "gpt-image-2"
# 备用模型可扩展
DEFAULT_ASPECT_RATIO = "16:9"
DEFAULT_SIZE = "2K"
DEFAULT_OUTPUT_DIR = "./output"

# GPT-Image-2 分辨率映射表
# https://doc.dmxapi.cn/img-nano-banana.html
RESOLUTION_MAP = {
    "16:9": {
        "1K": "1376x768",
        "2K": "2752x1536",
        "4K": "5504x3072"
    },
    "9:16": {
        "1K": "768x1376",
        "2K": "1536x2752",
        "4K": "3072x5504"
    },
    "1:1": {
        "1K": "1024x1024",
        "2K": "2048x2048",
        "4K": "4096x4096"
    },
    "21:9": {
        "1K": "1584x672",
        "2K": "3168x1344",
        "4K": "6336x2688"
    },
    "3:2": {
        "1K": "1264x848",
        "2K": "2528x1696",
        "4K": "5056x3392"
    },
    "2:3": {
        "1K": "848x1264",
        "2K": "1696x2528",
        "4K": "3392x5056"
    },
    "4:3": {
        "1K": "1200x896",
        "2K": "2400x1792",
        "4K": "4800x3584"
    },
    "3:4": {
        "1K": "896x1200",
        "2K": "1792x2400",
        "4K": "3584x4800"
    },
    "4:5": {
        "1K": "928x1152",
        "2K": "1856x2304",
        "4K": "3712x4608"
    },
    "5:4": {
        "1K": "1152x928",
        "2K": "2304x1856",
        "4K": "4608x3712"
    }
}

# 布局模式
# single: 单张大图
# grid-3x3: 九宫格分镜（3x3 storyboard，适合视频分镜）
LAYOUT_MODES = {
    "single": "单张大图模式",
    "grid-3x3": "3x3九宫格分镜模式（适合视频分镜）"
}

# 文字关键词列表（用于检测是否需要文字标注）
TEXT_KEYWORDS = [
    "标注", "文字", "地名", "数据", "标签", "文字说明",
    "label", "annotation", "caption", "text"
]

# 场景切换词列表（用于检测提示词是否包含多个不同场景）
SCENE_SWITCH_KEYWORDS = [
    "→", "、", "。", "！", "？", ".", ",", ";", ":", "、",
    "和", "以及", "以及", "还有", "加上", "包含",
    "分别是", "分为", "包括", "包含", "包括",
    "然后", "接着", "之后", "最后",
    "不仅是", "更是", "还有", "包括"
]

# 生僻词替换表（即梦对生僻中文支持不好，替换为更常见的表达）
UNCOMMON_WORD_REPLACEMENTS = {
    "公顷": "hm²",
    "平方公里": "km²",
    "千米": "km",
    "米": "m",
    "摄氏度": "°C",
    "度": "°",
    "pH值": "pH",
    "百分比": "%",
    "千分比": "‰"
}

# 风格提示词模板
STYLE_PROMPTS = {
    "epic-cold": """地理科普视频风格，16:9宽画幅。
运镜：高空航拍，缓慢俯瞰，从远景推至中景。
画幅：广角全景，展现地形全貌，山峰连绵起伏。
特效：山脉生长动画，等高线逐层浮现，地形从平面展开为立体。
调色：冷色调主导，深蓝(#2B4C7E) + 灰白(#E8E8E8)，低饱和度(<0.35)。
光影：侧光照射，山峰轮廓锐利，阴影层次分明。
细节：精细等高线，海拔数据以数字符号呈现，比例尺和指南针图形化。
氛围：史诗感，庄重肃穆，信息密集。
重要约束：纯视觉呈现，避免文字标注，专注于地形特征。
场景要求：{prompt}。""",

    "vitality": """地理科普视频风格，16:9宽画幅。
运镜：跟随航拍，沿河流/地形轮廓飞行，流畅过渡。
画幅：中景特写，展示地貌纹理和人文元素。
特效：地形展开动画，河流流动，动态箭头指示流向。
调色：冷暖对比，蓝绿(#4A90A4) + 橙黄(#FFB84D)，中等饱和度(0.38)。
光影：正面光照，明亮通透，温暖阳光感。
细节：实景航拍与地形纹理叠加，动态箭头图形化，无文字标注。
氛围：活力感，生机勃勃，人文气息。
重要约束：纯视觉呈现，避免文字标注，专注于动态特征。
场景要求：{prompt}。""",

    "seasonal-hybrid": """地理科普视频风格，16:9宽画幅。
运镜：升降航拍，从高空俯瞰至地面特写，流畅过渡。
画幅：广角+特写结合，展现城市全貌和细节。
特效：季节变换动画，城市轮廓逐层浮现，季节元素动态呈现。
调色：冷暖强烈对比，高对比度(>60)，高亮度(>130)。
光影：散射光照，明亮通透，层次分明。
细节：季节标注图标化，省份边界色块化，文化元素符号化。
氛围：明亮通透，层次分明，人文情怀。
重要约束：纯视觉呈现，避免文字标注，专注于季节特征。
场景要求：{prompt}.""",

    "mixed": """地理科普视频风格，16:9宽画幅。
运镜：复合运镜，航拍+推拉+摇移，多角度展示。
画幅：全景+中景+特写，信息层次丰富。
特效：多元素融合，地形展开+等高线浮现+数据可视化，动态呈现。
调色：冷色调主导，暖色点缀，信息密集。
光影：自然光照，专业地图感，信息可视化。
细节：地图层+实景层+标注层，多层融合，无文字标注。
氛围：专业严谨，信息密集，动态节奏。
重要约束：纯视觉呈现，避免文字标注，专注于综合特征。
场景要求：{prompt}."""
}


def load_config():
    """从 ~/.openclaw/openclaw.json 读取配置"""
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    try:
        with open(config_path) as f:
            return json.load(f)
    except Exception:
        return {}


def enhance_prompt_with_gemini(prompt, style, api_key):
    """调用 Gemini Flash 将简短描述扩写为电影级视觉场景描述"""
    if not api_key:
        return None

    style_hints = {
        "epic-cold": "高冷史诗风格，冷色调，精细地形纹理，大气透视感强烈",
        "vitality": "生机活力风格，冷暖对比，动感，人文与自然交融",
        "seasonal-hybrid": "季节人文风格，明亮通透，季节色彩鲜明，层次丰富",
        "mixed": "综合地理风格，信息层次丰富，多视角融合",
    }
    style_hint = style_hints.get(style, "地理科普视频风格")

    gemini_prompt = (
        f'你是专业的地理纪录片摄影指导，擅长{style_hint}。\n'
        f'请扩写以下地理场景描述，使其更具视觉冲击力，适合生成电影级地理科普视频画面。\n'
        f'只描述摄影机能拍到的内容：地形形态、色彩层次、光线质感、大气效果、标志性视觉元素。\n'
        f'不要历史文化背景，不要数据统计，中文回答，3-5句话，聚焦视觉细节。\n'
        f'场景：{prompt}'
    )

    payload = {
        "model": "gemini-2.0-flash-preview",
        "messages": [{"role": "user", "content": gemini_prompt}],
        "max_tokens": 300,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        print(f"✨ 正在调用 Gemini 扩写场景描述...")
        resp = requests.post(
            os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions",
            json=payload, headers=headers, timeout=20
        )
        resp.raise_for_status()
        enhanced = resp.json()["choices"][0]["message"]["content"].strip()
        print(f"✅ 场景描述扩写成功")
        return enhanced
    except Exception as e:
        print(f"⚠️ Gemini 扩写调用失败: {e}，使用原始描述")
        return None


def replace_obscure_words(prompt):
    for obscure, common in UNCOMMON_WORD_REPLACEMENTS.items():
        if obscure in prompt:
            prompt = prompt.replace(obscure, common)
    return prompt


def has_scene_switches(prompt):
    """检测提示词是否包含多个不同场景（不适合九宫格）"""
    prompt_lower = prompt.lower()

    # 统计场景切换关键词的数量
    switch_count = sum(1 for keyword in SCENE_SWITCH_KEYWORDS if keyword in prompt_lower)

    # 检测是否包含多个不同的地理主题词
    theme_keywords = {
        "火山": ["火山", "volcano"],
        "湖": ["湖", "lake"],
        "山": ["山", "mountain"],
        "河": ["河", "river"],
        "海": ["海", "sea", "ocean"],
        "沙漠": ["沙漠", "desert", "沙海"],
        "冰川": ["冰川", "glacier"],
        "城市": ["城市", "city"],
        "森林": ["森林", "forest"],
        "火焰": ["火焰", "fire", "蓝焰", "硫磺"]
    }

    # 统计出现的主题数量
    theme_count = 0
    for theme, keywords in theme_keywords.items():
        if any(keyword in prompt_lower for keyword in keywords):
            theme_count += 1

    return switch_count >= 2 or theme_count >= 3


def has_text_requirements(prompt):
    """检测提示词中是否包含文字需求"""
    prompt_lower = prompt.lower()
    return any(keyword in prompt_lower for keyword in TEXT_KEYWORDS)


def generate_image(prompt, style, aspect_ratio, size, output_dir, api_key, layout, fix_text=False):
    """生成地理风格图片"""

    # 检测是否需要文字标注
    needs_text = has_text_requirements(prompt)

    # 检测是否有多个不同场景（不适合九宫格）
    has_multiple_scenes = has_scene_switches(prompt)

    # 如果需要文字但选择了九宫格模式，自动切换为单图模式
    if needs_text and layout == "grid-3x3":
        print("⚠️  检测到文字标注需求，自动切换为单图模式（九宫格模式不适合文字标注）")
        layout = "single"

    # 如果有多个不同场景且选择了九宫格模式，自动切换为单图模式
    if has_multiple_scenes and layout == "grid-3x3":
        print("⚠️  检测到多个不同场景，自动切换为单图模式（九宫格模式适用于场景相似、风格一致的画面）")
        layout = "single"

    # 替换生僻词为更常见的表达
    prompt = replace_obscure_words(prompt)
    if any(obscure in prompt for obscure in UNCOMMON_WORD_REPLACEMENTS.keys()):
        print("📝 已替换生僻词为更常见的表达：")
        for obscure, common in UNCOMMON_WORD_REPLACEMENTS.items():
            if obscure in prompt:
                print(f"   {obscure} → {common}")

    # 文字修复模式
    if fix_text:
        print("🔧 文字修复模式：使用最高分辨率重新生成，修复文字错误")
        full_prompt = f"请将该图片用最高分辨率重新生成，修复文字错误。文字内容：{prompt}"
    else:
        # 正常模式：构建完整提示词
        layout_prefix = ""
        if layout == "grid-3x3":
            layout_prefix = """3x3九宫格影视分镜图（Storyboard），九个分镜按时间顺序或不同视角排列：
【左上-中上-右上】开场和全景视角
【左中-中中-右中】发展和细节视角
【左下-中下-右下】高潮和结尾视角

每个分镜独立但连贯，展现地理场景的不同角度、高度、时间或视角。
分镜之间有细微的分隔线，整体布局清晰。

"""

        if style in STYLE_PROMPTS:
            full_prompt = layout_prefix + STYLE_PROMPTS[style].format(prompt=prompt)
        else:
            print(f"警告：未知风格 '{style}'，使用默认风格")
            full_prompt = layout_prefix + STYLE_PROMPTS["epic-cold"].format(prompt=prompt)

    # 构建 Gemini API 请求参数
    # 参考: https://doc.dmxapi.cn/img-nano-banana.html
    payload = {
        "contents": [{
            "parts": [{
                "text": full_prompt
            }]
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": size
            }
        }
    }

    # 请求头 - 使用 x-goog-api-key 认证
    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json"
    }

    print("=" * 60)
    print("🎨 开始生成地理视频风格图片...")
    print("=" * 60)
    if fix_text:
        print(f"🔧 文字修复模式")
        print(f"文字内容: {prompt}")
    else:
        print(f"布局模式: {layout} ({LAYOUT_MODES.get(layout, '未知')})")
        print(f"风格: {style}")
    print(f"宽高比: {aspect_ratio} ({RESOLUTION_MAP.get(aspect_ratio, {}).get(size, 'N/A')})")
    print(f"分辨率: {size}")
    print(f"模型: {DEFAULT_MODEL}")
    if not fix_text:
        print(f"场景描述: {prompt}")
    print("=" * 60)

    try:
        # 发送请求
        print("📡 正在向 DMXAPI Gemini 发送请求...")
        response = requests.post(DEFAULT_API_URL, json=payload, headers=headers, timeout=300)
        
        if response.status_code != 200:
            print(f"❌ 请求失败: HTTP {response.status_code}")
            print(f"响应内容: {response.text[:500]}")
            return None
            
        result = response.json()
        print("✓ API 响应成功！")

        # 创建输出目录
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 解析 Gemini API 响应格式
        # 响应格式: {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": "base64..."}}]}}]}
        if 'candidates' in result and len(result['candidates']) > 0:
            candidate = result['candidates'][0]
            if 'content' in candidate and 'parts' in candidate['content']:
                parts = candidate['content']['parts']
                
                for part in parts:
                    if 'inlineData' in part:
                        # Base64 图片数据
                        inline_data = part['inlineData']
                        mime_type = inline_data.get('mimeType', 'image/png')
                        base64_data = inline_data.get('data', '')
                        
                        if base64_data:
                            image_bytes = base64.b64decode(base64_data)
                            
                            # 生成文件名
                            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                            if fix_text:
                                filename = f"geo_text_fixed_{timestamp}.png"
                            else:
                                filename = f"geo_{style}_{layout}_{timestamp}.png"
                            filepath = os.path.join(output_dir, filename)
                            
                            # 保存图片
                            with open(filepath, 'wb') as f:
                                f.write(image_bytes)
                            
                            file_size = os.path.getsize(filepath) / 1024
                            print(f"✓ 图片已保存: {filepath} ({file_size:.2f} KB)")
                            
                            # 保存元数据
                            metadata = {
                                "style": style,
                                "layout": layout,
                                "fix_text": fix_text,
                                "aspect_ratio": aspect_ratio,
                                "size": size,
                                "resolution": RESOLUTION_MAP.get(aspect_ratio, {}).get(size, "N/A"),
                                "model": DEFAULT_MODEL,
                                "prompt": prompt,
                                "full_prompt": full_prompt,
                                "generated_at": datetime.now().isoformat()
                            }
                            
                            metadata_file = filepath.replace('.png', '_metadata.json')
                            with open(metadata_file, 'w', encoding='utf-8') as f:
                                json.dump(metadata, f, ensure_ascii=False, indent=2)
                            
                            print(f"✓ 元数据已保存: {metadata_file}")
                            print("=" * 60)
                            print("✅ 生成完成！")
                            print("=" * 60)
                            
                            return filepath
        
        print("❌ 未找到图片数据")
        print(f"响应结构: {json.dumps(result, ensure_ascii=False, indent=2)[:500]}")
        return None

    except requests.exceptions.RequestException as e:
        print(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"HTTP 状态码: {e.response.status_code}")
            print(f"响应内容: {e.response.text[:500]}")
        return None

    except Exception as e:
        print(f"❌ 发生错误: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description="生成地理视频风格图片（DMXAPI Gemini 3 Pro Image Preview）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
风格说明：
  epic-cold      高冷史诗风格（深蓝、低饱和、精细等高线）
  vitality       生机活力风格（冷暖对比、动态箭头、人文元素）
  seasonal-hybrid 季节人文风格（强对比、明亮、季节元素）
  mixed          混合风格（冷色调主导、信息密集）

示例：
  python generate_geography_image.py "香格里拉的高山湖泊" --style epic-cold
  python generate_geography_image.py "珠江三角洲" --style vitality --size 2K
  
API 文档: https://doc.dmxapi.cn/img-nano-banana.html
        """
    )

    parser.add_argument("prompt", help="场景描述（例如：'香格里拉的高山湖泊'）")
    parser.add_argument("--style", default="epic-cold",
                       choices=["epic-cold", "vitality", "seasonal-hybrid", "mixed"],
                       help="风格选择（默认：epic-cold）")
    parser.add_argument("--aspect-ratio", default="16:9",
                       choices=["16:9", "9:16", "1:1", "21:9", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4"],
                       help="宽高比（默认：16:9）")
    parser.add_argument("--size", default="2K",
                       choices=["1K", "2K", "4K"],
                       help="分辨率（默认：2K）")
    parser.add_argument("--layout", default="single",
                       choices=["single", "grid-3x3"],
                       help="布局模式（默认：single）- single:单张大图, grid-3x3:九宫格分镜（适合视频分镜）")
    parser.add_argument("--fix-text", action="store_true",
                       help="文字修复模式：重新生成并修复文字错误（适用于有中文文字的图片）")
    parser.add_argument("--analyze", action="store_true",
                       help="生成后使用豆包API进行地理分析，检测地理问题")
    parser.add_argument("--analyze-optimize", action="store_true",
                       help="生成优化后的提示词（需要 --analyze）")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR,
                       help="输出目录（默认：./output）")
    parser.add_argument("--offline", action="store_true",
                       help="离线模式（不调用 Gemini 扩写提示词）")
    parser.add_argument("--api-key",
                       default=None,
                       help="DMXAPI Key（默认从 ~/.openclaw/openclaw.json 读取 dmxApiKey）")
    parser.add_argument("--doubao-api-key",
                       default=os.environ.get("DOUBAO_API_KEY"),
                       help="豆包API Key（用于地理分析，或从环境变量 DOUBAO_API_KEY 读取）")
    parser.add_argument("--doubao-endpoint",
                       default=os.environ.get("DOUBAO_ENDPOINT"),
                       help="豆包推理接入点ID（用于地理分析，或从环境变量 DOUBAO_ENDPOINT 读取）")

    args = parser.parse_args()

    # 加载配置（优先使用 DMMXAPI_KEY）
    config = load_config()
    dmx_api_key = args.api_key or config.get("dmxApiKey", os.environ.get("DMXAPI_KEY", os.environ.get("BANANA_API_KEY", "")))

    if not dmx_api_key:
        print("❌ 错误：未提供 API Key")
        print("   请在 ~/.openclaw/openclaw.json 设置 dmxApiKey，或使用 --api-key 参数")
        return 1

    # Gemini 扩写提示词（非 fix-text 模式、非 offline 模式时执行）
    prompt = args.prompt
    if not args.fix_text and not args.offline:
        enhanced = enhance_prompt_with_gemini(prompt, args.style, dmx_api_key)
        if enhanced:
            prompt = enhanced

    result = generate_image(
        prompt=prompt,
        style=args.style,
        aspect_ratio=args.aspect_ratio,
        size=args.size,
        output_dir=args.output,
        api_key=dmx_api_key,
        layout=args.layout,
        fix_text=args.fix_text
    )
    # 如果生成成功且需要分析
    if result and args.analyze:
        print("\n")
        if not args.doubao_api_key or not args.doubao_endpoint:
            print("⚠️ 跳过地理分析：未提供豆包API配置")
            print("   请设置 --doubao-api-key 和 --doubao-endpoint 参数")
            print("   或设置环境变量 DOUBAO_API_KEY 和 DOUBAO_ENDPOINT")
        else:
            try:
                from geography_analyzer import analyze_geography_image, save_analysis_result
                
                analysis_result = analyze_geography_image(
                    image_path=result,
                    prompt=args.prompt,
                    api_key=args.doubao_api_key,
                    endpoint=args.doubao_endpoint,
                    optimize=args.analyze_optimize
                )
                
                if analysis_result:
                    save_analysis_result(result, analysis_result, args.output)
            except ImportError:
                print("❌ 无法导入 geography_analyzer 模块")
                print("   请确保 geography_analyzer.py 在同一目录下")

    return 0 if result else 1


if __name__ == "__main__":
    exit(main())
