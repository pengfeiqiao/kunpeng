#!/usr/bin/env python3
"""
视频截帧 + 豆包多模态分析
1. 用 ffmpeg 均匀截取 N 帧（默认 25 帧，可自定义）
2. 并发调用豆包 doubao-seed-2-0-pro API 分析每帧
3. 输出分析报告（JSON + Markdown）+ 帧图片
"""

import sys
import os
import base64
import json
import subprocess
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

DMXAPI_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions"
MODEL_NAME  = "doubao-seed-2-0-pro-260215"
DEFAULT_PROMPT = (
    "请综合分析这张视频帧的内容，包括："
    "画面构成、视觉风格、情绪氛围、关键信息，"
    "以及这一帧在整体视频中可能的作用。"
)


# ── 工具函数 ───────────────────────────────────────────────────────────────────

def get_video_duration(video_path: str) -> float:
    """用 ffprobe 获取视频时长（秒）"""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def extract_frames(video_path: str, output_dir: str, frame_count: int) -> list:
    """
    均匀截取 frame_count 帧，避开前后 5% 的片段（片头片尾通常无意义）。
    返回帧图片路径列表（已排序）。
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    duration = get_video_duration(video_path)

    # 有效区间：5% ~ 95%
    start = duration * 0.05
    end   = duration * 0.95
    span  = end - start
    interval = span / (frame_count - 1) if frame_count > 1 else 0
    timestamps = [start + interval * i for i in range(frame_count)]

    frame_paths = []
    for i, ts in enumerate(timestamps, 1):
        frame_path = os.path.join(output_dir, f"frame_{i:03d}.jpg")
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{ts:.3f}",
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",          # 质量 1-31，2 约等于 90% JPEG
            "-vf", "scale=1280:-2",  # 限制宽度，减小 base64 体积
            frame_path,
        ]
        ret = subprocess.run(cmd, capture_output=True)
        if ret.returncode == 0 and os.path.exists(frame_path):
            size_kb = os.path.getsize(frame_path) / 1024
            print(f"  🎞️  帧 {i:03d}/{frame_count}  t={ts:.1f}s  {size_kb:.0f}KB  -> {frame_path}")
            frame_paths.append(frame_path)
        else:
            print(f"  ⚠️  帧 {i:03d} 截取失败（t={ts:.1f}s）: {ret.stderr.decode()[-200:]}")

    return sorted(frame_paths)


def analyze_frame(frame_path: str, prompt: str, api_key: str) -> dict:
    """调用豆包多模态 API 分析单帧，返回结果字典"""
    import requests

    with open(frame_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    payload = {
        "model": MODEL_NAME,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {
                    "url": f"data:image/jpeg;base64,{b64}"
                }},
            ],
        }],
        "temperature": 0.7,
        "max_tokens": 800,
    }

    resp = requests.post(DMXAPI_URL, json=payload, headers=headers, timeout=300)
    resp.raise_for_status()
    data = resp.json()
    analysis = data["choices"][0]["message"]["content"]
    return {
        "frame": os.path.basename(frame_path),
        "path": frame_path,
        "analysis": analysis,
        "success": True,
    }


def save_markdown_report(results: list, output_dir: str, analysis_desc: str) -> str:
    """生成可读的 Markdown 分析报告"""
    md_path = os.path.join(output_dir, "frames_analysis.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# 视频截帧分析报告\n\n")
        f.write(f"> **分析目标**：{analysis_desc or '综合分析视频内容'}\n\n")
        f.write(f"> **模型**：{MODEL_NAME}\n\n")
        f.write("---\n\n")
        for r in results:
            f.write(f"## {r['frame']}\n\n")
            f.write(f"![{r['frame']}]({r['path']})\n\n")
            if r.get("success"):
                f.write(r["analysis"].strip() + "\n\n")
            else:
                f.write(f"⚠️ 分析失败：{r.get('error', '未知错误')}\n\n")
            f.write("---\n\n")
    return md_path


# ── 主流程 ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="视频截帧 + 豆包多模态分析")
    parser.add_argument("video_path",         help="本地视频文件路径")
    parser.add_argument("--frame-count",  type=int, default=25,
                        help="截帧数量（默认 25，建议 10-100）")
    parser.add_argument("--analysis-desc", default="",
                        help="分析描述，告诉豆包想要分析什么")
    parser.add_argument("--output-dir",   default="",
                        help="输出目录（默认在视频同级目录下的 frames/ 子目录）")
    parser.add_argument("--api-key",      default="",
                        help="豆包 API Key（默认读取 $DOUBAO_API_KEY）")
    parser.add_argument("--workers",      type=int, default=4,
                        help="并发分析线程数（默认 4）")
    args = parser.parse_args()

    # 参数处理
    video_path = args.video_path
    if not os.path.exists(video_path):
        print(f"❌ 视频文件不存在: {video_path}")
        sys.exit(1)

    api_key = args.api_key or os.environ.get("DOUBAO_API_KEY", "")
    if not api_key:
        print("❌ 未设置 DOUBAO_API_KEY，请通过 --api-key 传入或设置环境变量")
        sys.exit(1)

    output_dir = args.output_dir or os.path.join(
        os.path.dirname(os.path.abspath(video_path)), "frames"
    )
    prompt = args.analysis_desc or DEFAULT_PROMPT
    frame_count = max(1, min(200, args.frame_count))  # 限制 1-200

    print(f"📹 视频：{video_path}")
    print(f"🎞️  截帧：{frame_count} 帧")
    print(f"📁 输出：{output_dir}")
    print(f"🤖 模型：{MODEL_NAME}")
    print(f"💬 分析：{prompt[:80]}...")

    # 阶段 1：截帧
    print("\n── 阶段 1：截帧 ──────────────────────")
    frame_paths = extract_frames(video_path, output_dir, frame_count)
    print(f"✅ 截帧完成，共 {len(frame_paths)} 帧")

    if not frame_paths:
        print("❌ 没有成功截取任何帧，退出")
        sys.exit(1)

    # 阶段 2：豆包多模态分析
    print(f"\n── 阶段 2：豆包分析（{args.workers} 线程并发）────")
    results = []
    failed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_path = {
            executor.submit(analyze_frame, p, prompt, api_key): p
            for p in frame_paths
        }
        for future in as_completed(future_to_path):
            fp = future_to_path[future]
            try:
                r = future.result()
                results.append(r)
                print(f"  ✅ {r['frame']}")
            except Exception as e:
                failed += 1
                results.append({
                    "frame": os.path.basename(fp),
                    "path": fp,
                    "error": str(e),
                    "success": False,
                })
                print(f"  ❌ {os.path.basename(fp)}: {e}")

    # 按帧序号排序
    results.sort(key=lambda r: r["frame"])

    # 阶段 3：保存报告
    print("\n── 阶段 3：保存报告 ──────────────────")
    json_path = os.path.join(output_dir, "frames_analysis.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    md_path = save_markdown_report(results, output_dir, args.analysis_desc)

    success_count = len(results) - failed
    print(f"\n✅ 完成！{success_count}/{len(results)} 帧分析成功")
    print(f"  📄 JSON 报告：{json_path}")
    print(f"  📄 Markdown 报告：{md_path}")
    print(f"  🖼️  帧图片：{output_dir}/frame_*.jpg")


if __name__ == "__main__":
    main()
