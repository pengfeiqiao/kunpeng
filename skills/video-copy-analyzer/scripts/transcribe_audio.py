#!/usr/bin/env python3
"""
Whisper 语音转录脚本
使用 OpenAI Whisper 将视频/音频转录为 SRT 字幕
"""

import sys
import os
import subprocess
import tempfile
from pathlib import Path

def check_dependencies():
    """检查必要依赖"""
    try:
        import whisper
        return True
    except ImportError:
        print("❌ 缺少依赖: openai-whisper")
        print("安装命令: pip install openai-whisper")
        return False

def extract_audio(video_path: str, audio_path: str) -> bool:
    """从视频中提取音频"""
    try:
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le",
            "-ar", "16000", "-ac", "1",
            audio_path
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ 音频提取失败: {e}")
        return False

def format_timestamp(seconds: float) -> str:
    """格式化时间戳为 SRT 格式"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def transcribe(video_path: str, output_srt: str, model_name: str = "medium",
               language: str = "auto", device: str = "cuda"):
    """
    执行转录
    
    Args:
        video_path: 视频文件路径
        output_srt: 输出 SRT 文件路径
        model_name: Whisper 模型 (tiny/base/small/medium/large)
        language: 语言 (zh/en/auto)
        device: 设备 (cuda/cpu)
    """
    import whisper
    import torch
    
    # 检查 CUDA 可用性
    if device == "cuda" and not torch.cuda.is_available():
        print("⚠️ CUDA 不可用，回退到 CPU")
        device = "cpu"
    
    print(f"📥 加载 Whisper {model_name} 模型...")
    model = whisper.load_model(model_name, device=device)
    
    # 提取音频到临时文件
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    
    print("🎵 提取音频...")
    if not extract_audio(video_path, audio_path):
        return False
    
    print("🎤 转录中...")
    options = {"task": "transcribe"}
    if language != "auto":
        options["language"] = language
    
    result = model.transcribe(audio_path, **options)
    
    # 生成 SRT 文件
    print("📝 生成字幕文件...")
    with open(output_srt, "w", encoding="utf-8") as f:
        for i, segment in enumerate(result["segments"], 1):
            start = format_timestamp(segment["start"])
            end = format_timestamp(segment["end"])
            text = segment["text"].strip()
            f.write(f"{i}\n{start} --> {end}\n{text}\n\n")
    
    # 清理临时文件
    os.unlink(audio_path)
    
    print(f"✅ 转录完成: {output_srt}")
    print(f"   检测语言: {result.get('language', 'unknown')}")
    print(f"   片段数量: {len(result['segments'])}")
    
    return True

def main():
    if len(sys.argv) < 3:
        print("用法: python transcribe_audio.py <视频路径> <输出SRT路径> [模型] [语言] [设备]")
        print("模型: tiny/base/small/medium/large (默认: medium)")
        print("语言: zh/en/auto (默认: auto)")
        print("设备: cuda/cpu (默认: cuda)")
        sys.exit(1)
    
    if not check_dependencies():
        sys.exit(1)
    
    video_path = sys.argv[1]
    output_srt = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "medium"
    language = sys.argv[4] if len(sys.argv) > 4 else "auto"
    device = sys.argv[5] if len(sys.argv) > 5 else "cuda"
    
    if not os.path.exists(video_path):
        print(f"❌ 视频文件不存在: {video_path}")
        sys.exit(1)
    
    success = transcribe(video_path, output_srt, model_name, language, device)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
