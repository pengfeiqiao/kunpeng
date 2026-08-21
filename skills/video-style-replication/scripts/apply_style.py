#!/usr/bin/env python3
"""应用已保存的风格到新场景"""
import argparse
import json
from pathlib import Path
import sys

# 添加父目录到路径
sys.path.append(str(Path(__file__).parent.parent))

from utils.dmxapi_client import DMXAPIClient

# 桌面视频复刻文件夹
DESKTOP_STYLE_DIR = Path.home() / "Desktop" / "视频复刻"

def main():
    parser = argparse.ArgumentParser(description="应用已保存的风格")
    parser.add_argument("--style", required=True, help="风格名称")
    parser.add_argument("--scene", required=True, help="新场景名称")
    parser.add_argument("--validate", action="store_true", help="生成验证图")
    args = parser.parse_args()
    
    # 读取风格配置
    style_dir = DESKTOP_STYLE_DIR / args.style
    config_path = style_dir / "style-config.json"
    
    if not config_path.exists():
        print(f"❌ 找不到风格: {args.style}")
        print(f"💡 提示: 请检查路径 {style_dir}")
        return
    
    with open(config_path, "r", encoding="utf-8") as f:
        style_template = json.load(f)
    
    print(f"✅ 已加载风格: {args.style}")
    
    # 生成提示词
    print(f"🎨 正在为场景 '{args.scene}' 生成提示词...")
    
    try:
        client = DMXAPIClient()
        prompt_result = client.generate_prompts(style_template, args.scene)
    except ValueError as e:
        print(e)
        return
    
    if "choices" not in prompt_result:
        print(f"❌ 提示词生成失败: {prompt_result}")
        return
    
    prompts_content = prompt_result["choices"][0]["message"]["content"]
    
    # 尝试解析 JSON
    try:
        prompts = json.loads(prompts_content)
    except json.JSONDecodeError:
        if "```json" in prompts_content:
            start = prompts_content.find("```json") + 7
            end = prompts_content.find("```", start)
            json_str = prompts_content[start:end].strip()
            prompts = json.loads(json_str)
        else:
            print("❌ 无法解析提示词结果")
            return
    
    # 保存提示词
    prompts_path = style_dir / f"prompts_{args.scene}.json"
    with open(prompts_path, "w", encoding="utf-8") as f:
        json.dump(prompts, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 提示词已保存: {prompts_path}")
    
    # 打印提示词
    print("\n" + "="*60)
    print("【正面提示词】")
    print(prompts.get("positive_prompt", ""))
    print("\n【负面提示词】")
    print(prompts.get("negative_prompt", ""))
    print("\n【运镜建议】")
    for i, suggestion in enumerate(prompts.get("camera_suggestions", []), 1):
        print(f"{i}. {suggestion}")
    print("\n【光影时机】")
    print(prompts.get("timing_suggestions", ""))
    print("="*60 + "\n")
    
    # 如果需要验证，生成图片
    if args.validate:
        print("🖼️ 正在生成验证图（Gemini）...")
        image_path = client.generate_image(
            prompts["positive_prompt"],
            output_path=str(style_dir / f"validation_{args.scene}.jpg")
        )
        if image_path:
            print(f"✅ 验证图已保存: {image_path}")
        else:
            print("❌ 验证图生成失败")
    
    print(f"\n🎉 完成！文件已保存到: {style_dir}")

if __name__ == "__main__":
    main()
