#!/usr/bin/env python3
"""
智能字幕提取脚本 - FunASR + RapidOCR 版本
流程：内嵌字幕 → 烧录字幕检测(RapidOCR) → FunASR语音转录

技术栈：
- RapidOCR (ONNX): 轻量级 OCR，用于提取烧录字幕
- FunASR Nano: 中文语音转录，效果优于 Whisper
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
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        streams = data.get("streams", [])
        subtitle_streams = [s for s in streams if s.get("codec_type") == "subtitle"]
        
        if subtitle_streams:
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
    """截取视频指定时间的帧"""
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
    """使用 RapidOCR 检测画面是否有烧录字幕"""
    try:
        from rapidocr_onnxruntime import RapidOCR
        
        ocr = RapidOCR()
        result = ocr(frame_path)
        
        # 如果检测到文字，认为有烧录字幕
        if result and result[0]:
            text_count = len([line for line in result[0] if line])
            # 检测到至少2行文字，认为是字幕
            return text_count >= 2
        return False
    except ImportError:
        print("⚠️ RapidOCR 未安装，跳过烧录字幕检测")
        print("   安装命令: pip install rapidocr-onnxruntime")
        return False
    except Exception as e:
        print(f"⚠️ OCR 检测失败: {e}")
        return False


def extract_burned_subtitle_ocr(video_path: str, output_srt: str) -> bool:
    """使用 RapidOCR 提取烧录字幕"""
    try:
        from rapidocr_onnxruntime import RapidOCR
        
        print("🔍 使用 RapidOCR 提取烧录字幕...")
        
        cmd = [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        duration = float(result.stdout.strip())
        
        ocr = RapidOCR()
        
        # 每隔2秒截取一帧进行 OCR（减少计算量）
        subtitles = []
        for t in range(0, int(duration), 2):
            frame_path = capture_frame(video_path, f"00:00:{t:02d}")
            if not frame_path:
                continue
            
            result = ocr(frame_path)
            if result and result[0]:
                # 提取文字
                texts = []
                for line in result[0]:
                    if line:
                        text = line[1]
                        confidence = line[2]
                        if confidence > 0.7:  # 置信度阈值
                            texts.append(text)
                
                if texts:
                    subtitles.append({
                        'index': len(subtitles) + 1,
                        'start': f"00:00:{t:02d},000",
                        'end': f"00:00:{t+2:02d},000",
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


def extract_audio(video_path: str, audio_path: str) -> bool:
    """从视频中提取音频"""
    try:
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le",
            "-ar", "16000", "-ac", "1",
            audio_path
        ]
        subprocess.run(cmd, capture_output=True, check=True)
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


def extract_with_funasr(video_path: str, output_srt: str) -> bool:
    """
    使用 FunASR 进行语音转录
    使用 Nano 模型，轻量且中文效果好
    """
    try:
        from funasr import AutoModel
        
        print("🎤 使用 FunASR Nano 进行语音转录...")
        print("   模型: iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch")
        
        # 提取音频
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            audio_path = tmp.name
        
        if not extract_audio(video_path, audio_path):
            return False
        
        # 加载 FunASR 模型
        model = AutoModel(
            model="iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            model_revision="v2.0.4",
            device="cpu",  # 可根据实际情况改为 "cuda"
        )
        
        # 转录
        result = model.generate(
            input=audio_path,
            batch_size_s=300,
            hotword=''
        )
        
        # 生成 SRT
        with open(output_srt, 'w', encoding='utf-8') as f:
            for i, res in enumerate(result, 1):
                if 'timestamp' in res and 'text' in res:
                    timestamps = res['timestamp']
                    text = res['text'].strip()
                    
                    if timestamps and len(timestamps) > 0:
                        start_sec = timestamps[0][0] / 1000  # 毫秒转秒
                        end_sec = timestamps[-1][1] / 1000
                        
                        start = format_timestamp(start_sec)
                        end = format_timestamp(end_sec)
                        
                        f.write(f"{i}\n{start} --> {end}\n{text}\n\n")
        
        # 清理临时文件
        os.unlink(audio_path)
        
        print(f"✅ FunASR 转录完成")
        return True
        
    except ImportError:
        print("❌ FunASR 未安装")
        print("   安装命令: pip install funasr modelscope")
        return False
    except Exception as e:
        print(f"❌ FunASR 转录失败: {e}")
        return False


def smart_subtitle_extraction(video_path: str, output_srt: str) -> tuple[bool, str]:
    """
    智能字幕提取主函数
    流程: 内嵌字幕 → 烧录字幕(RapidOCR) → FunASR语音转录
    
    返回: (是否成功, 使用的模式)
    """
    print("=" * 50)
    print("🎬 智能字幕提取 (RapidOCR + FunASR)")
    print("=" * 50)
    print(f"视频: {video_path}")
    print()
    
    # 步骤1: 检查内嵌字幕
    print("步骤 1/3: 检查内嵌字幕...")
    has_embedded, result = check_embedded_subtitle(video_path)
    if has_embedded:
        print(f"✅ 发现内嵌字幕，已提取: {result}")
        if result != output_srt:
            import shutil
            shutil.copy(result, output_srt)
        return True, "embedded"
    else:
        print(f"⚠️ {result}")
    
    # 步骤2: 检测烧录字幕
    print("\n步骤 2/3: 检测烧录字幕 (RapidOCR)...")
    frame_path = capture_frame(video_path, "00:00:05")
    if frame_path:
        has_burned = check_burned_subtitle(frame_path)
        os.unlink(frame_path)
        
        if has_burned:
            print("✅ 检测到烧录字幕，使用 RapidOCR 提取...")
            if extract_burned_subtitle_ocr(video_path, output_srt):
                return True, "ocr"
        else:
            print("⚠️ 未检测到烧录字幕")
    
    # 步骤3: 使用 FunASR
    print("\n步骤 3/3: 使用 FunASR Nano 语音转录...")
    if extract_with_funasr(video_path, output_srt):
        return True, "funasr"
    
    return False, "failed"


def main():
    if len(sys.argv) < 3:
        print("用法: python extract_subtitle_funasr.py <视频路径> <输出SRT路径>")
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
