#!/usr/bin/env python3
"""
视频场景检测 - 从关键帧中检测镜头切换点
"""
import os
import cv2
import numpy as np
import json
import shutil
from pathlib import Path


def detect_scenes(frames_dir, output_dir, threshold=0.5, min_scene_len=3):
    """
    检测镜头切换点，提取每个镜头的起始帧和中间帧
    
    Args:
        frames_dir: 关键帧目录
        output_dir: 输出目录
        threshold: 场景切换阈值 (0-1, 越小越敏感)
        min_scene_len: 最小场景长度（秒）
    """
    os.makedirs(output_dir, exist_ok=True)
    
    frames = sorted([f for f in os.listdir(frames_dir) if f.endswith(('.jpg', '.jpeg', '.png'))])
    print(f"总帧数: {len(frames)}")
    
    prev_hist = None
    scenes = []
    scene_start_idx = 0
    
    for i, fname in enumerate(frames):
        path = os.path.join(frames_dir, fname)
        img = cv2.imread(path)
        if img is None:
            continue
        
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        hist = hist.flatten()
        
        if prev_hist is not None:
            diff = cv2.compareHist(
                hist.reshape(50, 60).astype(np.float32),
                prev_hist.reshape(50, 60).astype(np.float32),
                cv2.HISTCMP_BHATTACHARYYA
            )
            
            if diff > threshold and (i - scene_start_idx) >= min_scene_len:
                scenes.append({
                    'start_frame': scene_start_idx,
                    'end_frame': i - 1,
                    'start_time': scene_start_idx,
                    'end_time': i - 1,
                    'mid_frame': (scene_start_idx + i - 1) // 2
                })
                scene_start_idx = i
        
        prev_hist = hist
    
    # 最后一个场景
    scenes.append({
        'start_frame': scene_start_idx,
        'end_frame': len(frames) - 1,
        'start_time': scene_start_idx,
        'end_time': len(frames) - 1,
        'mid_frame': (scene_start_idx + len(frames) - 1) // 2
    })
    
    print(f"检测到 {len(scenes)} 个镜头\n")
    
    # 复制每个镜头的起始帧
    copied = []
    for i, scene in enumerate(scenes):
        src_idx = scene['start_frame'] + 1
        src = os.path.join(frames_dir, f"frame_{src_idx:04d}.jpg")
        dst = os.path.join(output_dir, f"scene_{i+1:02d}_start.jpg")
        
        if os.path.exists(src):
            shutil.copy2(src, dst)
            copied.append(f"scene_{i+1:02d}_start.jpg")
            duration = scene['end_time'] - scene['start_time']
            print(f"  镜头 {i+1:02d}: {scene['start_time']:3d}s - {scene['end_time']:3d}s ({duration+1}s)")
    
    # 保存场景数据
    with open(os.path.join(output_dir, "scenes.json"), 'w') as f:
        json.dump(scenes, f, indent=2)
    
    print(f"\n已复制 {len(copied)} 个关键帧到 {output_dir}")
    return scenes


def extract_frames(video_path, output_dir, fps=1):
    """从视频中提取关键帧"""
    import subprocess
    os.makedirs(output_dir, exist_ok=True)
    
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(output_dir, "frame_%04d.jpg"),
        "-y"
    ]
    subprocess.run(cmd, capture_output=True)
    
    count = len(list(Path(output_dir).glob("*.jpg")))
    print(f"提取了 {count} 帧 (每{fps}秒1帧)")
    return count


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="视频场景检测")
    parser.add_argument("frames_dir", help="关键帧目录")
    parser.add_argument("-o", "--output", default="./keyframes", help="输出目录")
    parser.add_argument("-t", "--threshold", type=float, default=0.5, help="切换阈值")
    parser.add_argument("-m", "--min-len", type=int, default=3, help="最小场景长度(秒)")
    
    args = parser.parse_args()
    detect_scenes(args.frames_dir, args.output, args.threshold, args.min_len)
