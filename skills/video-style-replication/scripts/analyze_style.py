#!/usr/bin/env python3
"""
视频风格复刻主脚本
自动选择：视频直传（<50M）或帧分析（>50M）
导出到桌面"视频复刻"文件夹
"""
import argparse
import json
from pathlib import Path
import sys
import os
from datetime import datetime

# 添加父目录到路径
sys.path.append(str(Path(__file__).parent.parent))

from utils.dmxapi_client import DMXAPIClient
from utils.video_downloader import VideoDownloader

# 视频大小阈值（50MB）
VIDEO_SIZE_THRESHOLD = 50 * 1024 * 1024

# 桌面视频复刻文件夹
DESKTOP_STYLE_DIR = Path.home() / "Desktop" / "视频复刻"

def get_video_size(video_path):
    """获取视频文件大小"""
    return os.path.getsize(video_path)

def save_style_index(style_name, style_dir):
    """更新风格索引"""
    index_path = DESKTOP_STYLE_DIR / "index.json"
    
    # 读取现有索引
    if index_path.exists():
        with open(index_path, "r", encoding="utf-8") as f:
            index = json.load(f)
    else:
        index = {"styles": []}
    
    # 添加或更新风格
    style_entry = {
        "name": style_name,
        "path": str(style_dir),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat()
    }
    
    # 检查是否已存在
    existing = next((s for s in index["styles"] if s["name"] == style_name), None)
    if existing:
        existing.update(style_entry)
    else:
        index["styles"].append(style_entry)
    
    # 保存索引
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

def main():
    parser = argparse.ArgumentParser(description="视频风格复刻工具")
    parser.add_argument("--url", help="视频链接")
    parser.add_argument("--file", help="本地视频文件路径")
    parser.add_argument("--name", required=True, help="风格名称")
    parser.add_argument("--scene", help="新场景名称（可选）")
    parser.add_argument("--validate", action="store_true", help="生成验证图")
    parser.add_argument("--frames", type=int, default=12, help="提取帧数（大视频时使用）")
    parser.add_argument("--force-frames", action="store_true", help="强制使用帧分析模式")
    parser.add_argument("--keep-frames", action="store_true", help="保留参考帧")
    args = parser.parse_args()
    
    # 检查参数
    if not args.url and not args.file:
        print("❌ 错误: 必须提供 --url 或 --file 参数")
        return
    
    # 初始化客户端
    try:
        client = DMXAPIClient()
        downloader = VideoDownloader()
    except ValueError as e:
        print(e)
        return
    
    # 获取视频文件
    if args.file:
        # 使用本地文件
        video_path = Path(args.file).expanduser().absolute()
        if not video_path.exists():
            print(f"❌ 文件不存在: {video_path}")
            return
        print(f"📁 使用本地视频: {video_path}")
    else:
        # 下载在线视频
        print(f"📥 正在下载视频: {args.url}")
        try:
            video_path = downloader.download(args.url)
        except RuntimeError as e:
            print(e)
            return
    
    video_size = get_video_size(video_path)
    video_size_mb = video_size / (1024 * 1024)
    
    print(f"📊 视频大小: {video_size_mb:.2f} MB")
    
    # 智能选择分析策略
    if args.force_frames:
        print("⚙️ 强制使用帧分析模式")
        use_direct_video = False
    elif video_size <= VIDEO_SIZE_THRESHOLD:
        print("✅ 小视频，使用视频直传模式（豆包向量化分析）")
        use_direct_video = True
    else:
        print(f"⚠️ 大视频（>{VIDEO_SIZE_THRESHOLD/(1024*1024):.0f}MB），使用帧分析模式")
        use_direct_video = False
    
    # 读取 Prompt 模板
    skill_dir = Path(__file__).parent.parent
    with open(skill_dir / "references" / "prompts.md", "r", encoding="utf-8") as f:
        prompt_content = f.read()
        # 提取分析 Prompt
        start = prompt_content.find("## 风格分析 Prompt\n\n") + len("## 风格分析 Prompt\n\n")
        end = prompt_content.find("\n---\n", start)
        ANALYZE_STYLE_PROMPT = prompt_content[start:end].strip()
    
    # 执行分析
    frames_dir = None
    if use_direct_video:
        # 直接上传视频分析
        print("🔍 正在分析影调风格（视频直传模式）...")
        style_result = client.analyze_video_direct(video_path, ANALYZE_STYLE_PROMPT)
    else:
        # 提取关键帧分析
        print(f"🎬 正在提取关键帧（{args.frames}帧）...")
        frames_dir = downloader.extract_frames(
            video_path, 
            max_frames=args.frames,
            scene_threshold=0.3
        )
        
        print("🔍 正在分析影调风格（帧分析模式）...")
        style_result = client.analyze_frames(frames_dir, ANALYZE_STYLE_PROMPT)
    
    # 解析结果
    if "choices" not in style_result:
        print(f"❌ 分析失败: {style_result}")
        downloader.cleanup()
        return
    
    content = style_result["choices"][0]["message"]["content"]
    
    # 尝试提取 JSON
    try:
        # 尝试直接解析
        style_template = json.loads(content)
    except json.JSONDecodeError:
        # 尝试从 Markdown 代码块中提取
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            json_str = content[start:end].strip()
            style_template = json.loads(json_str)
        else:
            print("❌ 无法解析分析结果")
            print(f"原始内容: {content}")
            downloader.cleanup()
            return
    
    # 创建桌面导出目录
    style_dir = DESKTOP_STYLE_DIR / args.name
    style_dir.mkdir(parents=True, exist_ok=True)
    
    # 保存风格模板
    config_path = style_dir / "style-config.json"
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(style_template, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 风格模板已保存: {config_path}")
    
    # 保存参考帧（如果需要）
    if args.keep_frames and frames_dir:
        ref_frames_dir = style_dir / "reference-frames"
        ref_frames_dir.mkdir(exist_ok=True)
        
        import shutil
        for img_path in Path(frames_dir).glob("*.jpg"):
            shutil.copy(img_path, ref_frames_dir / img_path.name)
        
        print(f"✅ 参考帧已保存: {ref_frames_dir}")
    
    # 生成分析报告
    report_path = style_dir / "style-report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# {args.name} - 风格分析报告\n\n")
        f.write(f"**创建时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"**源视频**: {args.url}\n\n")
        f.write("## 核心影调系统\n\n")
        f.write(f"```json\n{json.dumps(style_template, ensure_ascii=False, indent=2)}\n```\n")
    
    print(f"✅ 分析报告已保存: {report_path}")
    
    # 更新索引
    save_style_index(args.name, style_dir)
    
    # 如果指定了新场景，生成提示词
    if args.scene:
        print(f"🎨 正在为场景 '{args.scene}' 生成提示词（豆包）...")
        prompt_result = client.generate_prompts(style_template, args.scene)
        
        if "choices" not in prompt_result:
            print(f"❌ 提示词生成失败: {prompt_result}")
        else:
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
                    prompts = None
            
            if prompts:
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
    
    # 清理临时文件
    downloader.cleanup()
    
    print(f"\n🎉 完成！所有文件已导出到: {style_dir}")

if __name__ == "__main__":
    main()
