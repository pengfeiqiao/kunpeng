"""
视频下载和关键帧提取工具
使用 yt-dlp 下载视频，FFmpeg 提取关键帧
"""
import subprocess
import tempfile
from pathlib import Path
import shutil


class VideoDownloader:
    def __init__(self):
        self.temp_dir = tempfile.mkdtemp()
    
    def download(self, url):
        """下载视频"""
        output_path = Path(self.temp_dir) / "video.mp4"
        
        cmd = [
            "yt-dlp",
            "-f", "best[ext=mp4]",
            "-o", str(output_path),
            "--no-playlist",
            url
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return str(output_path)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"❌ 视频下载失败: {e.stderr}")
    
    def extract_frames(self, video_path, max_frames=12, scene_threshold=0.3):
        """提取关键帧（场景切换检测）"""
        frames_dir = Path(self.temp_dir) / "frames"
        frames_dir.mkdir(exist_ok=True)
        
        # 使用 FFmpeg 场景切换检测
        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vf", f"select='gt(scene,{scene_threshold})',scale=1280:-1",
            "-vsync", "vfr",
            "-q:v", "2",
            str(frames_dir / "frame_%03d.jpg")
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            print(f"⚠️ 场景检测失败，使用均匀采样: {e.stderr}")
        
        # 如果提取的帧数不够，补充均匀采样
        frames = list(frames_dir.glob("*.jpg"))
        if len(frames) < max_frames:
            print(f"⚠️ 场景切换只提取到 {len(frames)} 帧，补充均匀采样...")
            cmd = [
                "ffmpeg",
                "-i", video_path,
                "-vf", f"fps=1/{max_frames*2},scale=1280:-1",
                "-q:v", "2",
                str(frames_dir / "extra_%03d.jpg")
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as e:
                print(f"⚠️ 均匀采样失败: {e.stderr}")
        
        return str(frames_dir)
    
    def cleanup(self):
        """清理临时文件"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
