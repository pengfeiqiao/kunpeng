#!/usr/bin/env python3
"""
智能字幕提取脚本
流程：内嵌字幕 → 烧录字幕检测(OCR) → Whisper语音转录
"""

import subprocess
import sys
import os
import tempfile
from pathlib import Path
import json


def check_embedded_subtitle(video_path: str) -> tuple[bool, str]:
    """
    检查视频是否包含内嵌字幕流
    返回: (是否有内嵌字幕, 字幕文件路径或错误信息)
    """
    try:
        # 使用 ffprobe 检查字幕流
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        streams = data.get("streams", [])
        subtitle_streams = [s for s in streams if s.get("codec_type") == "subtitle"]
        
        if subtitle_streams:
            # 提取第一个字幕流
            output_srt = video_path.rsplit(".", 1)[0] + "_embedded.srt"
            cmd = [
                "ffmpeg", "-y", "-i", video_path,
                "-map", f"0:s:0", output_srt
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return True, output_srt
        else:
            return False, "无内嵌字幕流"
    except Exception as e:
        return False, f"检测失败: {e}"


def capture_frame(video_path: str, timestamp: str = "00:00:05") -> str:
    """
    截取视频指定时间的帧
    默认截取第5秒（通常有字幕出现）
    """
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            frame_path = tmp.name
        
        cmd = [
            "ffmpeg", "-y", "-ss", timestamp, "-i", video_path,
            "-vframes", "1", "-q:v", "2", frame_path
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        return frame_path
    except Exception as e:
        return ""


def check_burned_subtitle(frame_path: str) -> bool:
    """
    使用 OCR 检测画面是否有烧录字幕
    返回: 是否检测到字幕
    """
    try:
        from paddleocr import PaddleOCR
        
        ocr = PaddleOCR(
            use_angle_cls=True,
            lang='ch',
            show_log=False,
            use_gpu=False  # CPU 运行
        )
        
        result = ocr.ocr(frame_path, cls=True)
        
        # 如果检测到文字，认为有烧录字幕
        if result and result[0]:
            text_count = len([line for line in result[0] if line])
            # 检测到至少3行文字，认为是字幕
            return text_count >= 3
        return False
    except ImportError:
        print("⚠️ PaddleOCR 未安装，跳过烧录字幕检测")
        return False
    except Exception as e:
        print(f"⚠️ OCR 检测失败: {e}")
        return False


def extract_burned_subtitle_ocr(video_path: str, output_srt: str) -> bool:
    """
    使用 OCR 提取烧录字幕
    策略：每隔1秒截取一帧，OCR识别文字，合并为SRT
    """
    try:
        from paddleocr import PaddleOCR
        import cv2
        
        print("🔍 使用 OCR 提取烧录字幕...")
        
        # 获取视频时长
        cmd = [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        duration = float(result.stdout.strip())
        
        ocr = PaddleOCR(
            use_angle_cls=True,
            lang='ch',
            show_log=False,
            use_gpu=False
        )
        
        # 每隔1秒截取一帧进行 OCR
        subtitles = []
        for t in range(0, int(duration), 1):
            frame_path = capture_frame(video_path, f"00:00:{t:02d}")
            if not frame_path:
                continue
            
            result = ocr.ocr(frame_path, cls=True)
            if result and result[0]:
                # 提取文字
                texts = []
                for line in result[0]:
                    if line:
                        text = line[1][0]
                        confidence = line[1][1]
                        if confidence > 0.7:  # 置信度阈值
                            texts.append(text)
                
                if texts:
                    subtitles.append({
                        'index': len(subtitles) + 1,
                        'start': f"00:00:{t:02d},000",
                        'end': f"00:00:{t+1:02d},000",
                        'text': ' '.join(texts)
                    })
            
            os.unlink(frame_path)
        
        # 写入 SRT 文件
        with open(output_srt, 'w', encoding='utf-8') as f:
            for sub in subtitles:
                f.write(f"{sub['index']}\n")
                f.write(f"{sub['start']} --> {sub['end']}\n")
                f.write(f"{sub['text']}\n\n")
        
        print(f"✅ OCR 提取完成: {len(subtitles)} 条字幕")
        return True
        
    except Exception as e:
        print(f"❌ OCR 提取失败: {e}")
        return False


def extract_with_whisper(video_path: str, output_srt: str, model: str = "large") -> bool:
    """
    使用 Whisper 进行语音转录
    """
    try:
        import whisper
        import torch
        
        print(f"🎤 使用 Whisper {model} 进行语音转录...")
        
        # 检查 CUDA
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cpu":
            print("⚠️ CUDA 不可用，使用 CPU（速度较慢）")
        
        # 加载模型
        model = whisper.load_model(model, device=device)
        
        # 转录
        result = model.transcribe(
            video_path,
            language="zh",
            task="transcribe",
            verbose=False
        )
        
        # 生成 SRT
        def format_timestamp(seconds: float) -> str:
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds % 1) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        
        with open(output_srt, 'w', encoding='utf-8') as f:
            for i, segment in enumerate(result["segments"], 1):
                start = format_timestamp(segment["start"])
                end = format_timestamp(segment["end"])
                text = segment["text"].strip()
                f.write(f"{i}\n{start} --> {end}\n{text}\n\n")
        
        print(f"✅ Whisper 转录完成: {len(result['segments'])} 条字幕")
        return True
        
    except Exception as e:
        print(f"❌ Whisper 转录失败: {e}")
        return False


def smart_subtitle_extraction(video_path: str, output_srt: str) -> tuple[bool, str]:
    """
    智能字幕提取主函数
    流程: 内嵌字幕 → 烧录字幕(OCR) → Whisper语音转录
    
    返回: (是否成功, 使用的模式)
    """
    print("=" * 50)
    print("🎬 智能字幕提取")
    print("=" * 50)
    print(f"视频: {video_path}")
    print()
    
    # 步骤1: 检查内嵌字幕
    print("步骤 1/3: 检查内嵌字幕...")
    has_embedded, result = check_embedded_subtitle(video_path)
    if has_embedded:
        print(f"✅ 发现内嵌字幕，已提取: {result}")
        # 复制到目标路径
        if result != output_srt:
            import shutil
            shutil.copy(result, output_srt)
        return True, "embedded"
    else:
        print(f"⚠️ {result}")
    
    # 步骤2: 检测烧录字幕
    print("\n步骤 2/3: 检测烧录字幕...")
    frame_path = capture_frame(video_path, "00:00:05")
    if frame_path:
        has_burned = check_burned_subtitle(frame_path)
        os.unlink(frame_path)
        
        if has_burned:
            print("✅ 检测到烧录字幕，使用 OCR 提取...")
            if extract_burned_subtitle_ocr(video_path, output_srt):
                return True, "ocr"
        else:
            print("⚠️ 未检测到烧录字幕")
    
    # 步骤3: 使用 Whisper
    print("\n步骤 3/3: 使用 Whisper 语音转录...")
    if extract_with_whisper(video_path, output_srt, "large"):
        return True, "whisper"
    
    return False, "failed"


def main():
    if len(sys.argv) < 3:
        print("用法: python extract_subtitle.py <视频路径> <输出SRT路径>")
        sys.exit(1)
    
    video_path = sys.argv[1]
    output_srt = sys.argv[2]
    
    if not os.path.exists(video_path):
        print(f"❌ 视频文件不存在: {video_path}")
        sys.exit(1)
    
    success, mode = smart_subtitle_extraction(video_path, output_srt)
    
    if success:
        print(f"\n✅ 字幕提取成功！")
        print(f"   模式: {mode}")
        print(f"   输出: {output_srt}")
        sys.exit(0)
    else:
        print(f"\n❌ 字幕提取失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
