#!/usr/bin/env python3
"""Local, timestamp-correct Video Depth Anything workflow; no implicit downloads."""
import argparse
import json
import hashlib
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def run(args):
    subprocess.run([str(x) for x in args], check=True, stdin=subprocess.DEVNULL)


def probe(path, ffprobe):
    data = subprocess.check_output([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)])
    info = json.loads(data)
    video = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
    if not video:
        raise ValueError('输入没有视频流')
    return info, video


def binary(name):
    found = shutil.which(name)
    if not found:
        raise ValueError(f'缺少 {name}，请先安装 FFmpeg 并加入 PATH')
    return found


def duration(video, info):
    value = float(video.get('duration') or info.get('format', {}).get('duration') or 0)
    if not math.isfinite(value) or value <= 0:
        raise ValueError('无法确认视频时长')
    return value


def validate_result(source_info, source_video, output_info, output_video, fps):
    expected = duration(source_video, source_info)
    actual = duration(output_video, output_info)
    if abs(expected - actual) > max(0.15, 2 / fps):
        raise ValueError(f'时长核验失败：原视频 {expected:.3f}s，深度视频 {actual:.3f}s')
    if int(output_video.get('nb_frames', 0)) < 1:
        raise ValueError('产物没有可验证的视频帧')
    return {'source_video_seconds': expected, 'output_video_seconds': actual,
            'duration_error_seconds': abs(expected - actual), 'frames': int(output_video['nb_frames'])}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def progress(stage, **values):
    print(json.dumps({'stage': stage, **values}, ensure_ascii=False), flush=True)


def normalization_bounds(depths):
    import numpy as np
    lo, hi = float('inf'), float('-inf')
    for frame in depths:
        if not np.isfinite(frame).all():
            raise ValueError('模型输出包含非有限深度值')
        lo, hi = min(lo, float(frame.min())), max(hi, float(frame.max()))
    raw_max = hi
    # One robust range for all frames; suppress rare outliers without frame-wise pumping.
    robust_max = float(np.percentile(depths[:, ::8, ::8], 99.5))
    if robust_max > lo + 1e-8:
        hi = min(hi, robust_max)
    if hi - lo < 1e-8:
        raise ValueError('深度结果无有效动态范围，拒绝输出全黑假成功')
    return lo, hi, raw_max


def infer(prepared, raw, repo, checkpoint, args):
    import numpy as np
    import torch
    import imageio.v2 as imageio
    sys.path.insert(0, str(repo))
    from video_depth_anything.video_depth import VideoDepthAnything
    from utils.dc_utils import read_video_frames
    device = args.device
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    if device == 'mps' and not torch.backends.mps.is_available():
        raise ValueError('MPS 不可用；请使用 auto 或 cpu')
    model = VideoDepthAnything(encoder='vits', features=64, out_channels=[48, 96, 192, 384])
    model.load_state_dict(torch.load(str(checkpoint), map_location='cpu', weights_only=True), strict=True)
    model = model.to(device).eval()
    frames, fps = read_video_frames(str(prepared), -1, args.fps, args.max_res)
    progress('inference', device=device, frames=len(frames), fps=fps, input_size=args.input_size)
    depths, fps = model.infer_video_depth(frames, fps, input_size=args.input_size, device=device, fp32=True)
    if len(depths) != len(frames):
        raise ValueError('模型输出帧数与输入不一致')
    # Use a single scale for the whole clip: per-frame normalization causes flicker.
    lo, hi, raw_max = normalization_bounds(depths)
    progress('encode', depth_min=lo, depth_max=hi)
    with imageio.get_writer(str(raw), fps=fps, macro_block_size=1, codec='libx264',
                           ffmpeg_params=['-crf', '18', '-pix_fmt', 'yuv420p']) as writer:
        for frame in depths:
            gray = np.clip((frame - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
            writer.append_data(gray)
    return {'device': device, 'normalization': 'clip_global_p995', 'depth_min': lo, 'depth_max': hi, 'raw_depth_max': raw_max}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--repo', type=Path, help='官方 Video-Depth-Anything 仓库目录')
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--fps', type=int, default=15, choices=range(1, 61))
    parser.add_argument('--input-size', type=int, default=256, choices=[196, 256, 392, 518])
    parser.add_argument('--max-res', type=int, default=720, choices=[512, 720, 960, 1280, 1920])
    parser.add_argument('--device', choices=['auto', 'mps', 'cuda', 'cpu'], default='auto')
    parser.add_argument('--silent', action='store_true', help='不要保留原声')
    parser.add_argument('--check', action='store_true', help='只检查输入、依赖与路径，不执行转换')
    args = parser.parse_args()
    config_path = Path.home() / '.kunpeng' / 'video-depth.json'
    config = json.loads(config_path.read_text()) if config_path.is_file() else {}
    repo = (args.repo or Path(config.get('repo', str(Path.home() / '.kunpeng' / 'runtimes' / 'Video-Depth-Anything')))).expanduser().resolve()
    checkpoint = (args.checkpoint or repo / 'checkpoints' / 'video_depth_anything_vits.pth').expanduser().resolve()
    source, output = args.input.expanduser().resolve(), args.output.expanduser().resolve()
    if not source.is_file():
        raise ValueError('输入文件不存在')
    if source == output or output.exists():
        raise ValueError('输出已存在或与原片相同，请选新文件名；不会覆盖原片或旧产物')
    if output.suffix.lower() != '.mp4':
        raise ValueError('输出必须是 .mp4')
    if not (repo / 'video_depth_anything' / 'video_depth.py').is_file() or not checkpoint.is_file():
        raise ValueError('缺少官方仓库或 Small 权重；参见技能 references/setup.md。不会自动改用逐帧模型或边缘滤镜')
    ffmpeg, ffprobe = binary('ffmpeg'), binary('ffprobe')
    source_info, source_video = probe(source, ffprobe)
    import importlib.util
    missing = [m for m in ['torch', 'torchvision', 'cv2', 'numpy', 'imageio', 'einops', 'easydict', 'matplotlib', 'tqdm'] if importlib.util.find_spec(m) is None]
    if missing:
        raise ValueError('当前 Python 缺少依赖：' + ', '.join(missing) + '；请选择深度专用虚拟环境')
    seconds = duration(source_video, source_info)
    if seconds * args.fps > 1800:
        raise ValueError('此离线实现最多处理1800帧；请降低fps或明确分段，避免耗尽内存。分段后需单独核验接缝')
    ratio = min(1.0, args.max_res / max(source_video['width'], source_video['height']))
    estimated_bytes = seconds * args.fps * source_video['width'] * source_video['height'] * ratio * ratio * 15
    if estimated_bytes > 3_000_000_000:
        raise ValueError('预计离线帧/深度缓存超过3GB，请降低fps或工作分辨率，或明确分段')
    progress('checked', input=str(source), duration=seconds, fps=args.fps, repo=str(repo), output=str(output))
    if args.check:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    # Unique job directory + exclusive lock: no accidental duplicate writers or partial final file.
    lock = output.with_suffix('.mp4.lock')
    with lock.open('x') as stream:
        stream.write(str(os.getpid()))
    try:
        with tempfile.TemporaryDirectory(prefix='depth-', dir=str(output.parent)) as tmp:
            work = Path(tmp)
            prepared, raw, final = work / 'prepared.mp4', work / 'depth.mp4', work / 'final.mp4'
            progress('prepare', note='按时间戳统一帧率，不按帧序号抽取')
            run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', source,
                 '-map', '0:v:0', '-an', '-vf', f"fps={args.fps},scale='min({args.max_res},iw)':'min({args.max_res},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                 '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', prepared])
            os.environ['IMAGEIO_FFMPEG_EXE'] = ffmpeg
            details = infer(prepared, raw, repo, checkpoint, args)
            progress('mux')
            command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', raw]
            if args.silent:
                command += ['-map', '0:v:0', '-an']
            else:
                command += ['-i', source, '-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'aac', '-b:a', '192k']
            target_width = int(source_video['width']) // 2 * 2
            target_height = int(source_video['height']) // 2 * 2
            if abs(int(source_video.get('tags', {}).get('rotate', 0))) % 180 == 90 or any(abs(int(d.get('rotation', 0))) % 180 == 90 for d in source_video.get('side_data_list', [])):
                target_width, target_height = target_height, target_width
            run(command + ['-vf', f'scale={target_width}:{target_height}:flags=bilinear,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', final])
            output_info, output_video = probe(final, ffprobe)
            verification = validate_result(source_info, source_video, output_info, output_video, args.fps)
            expected_audio = not args.silent and any(s['codec_type'] == 'audio' for s in source_info['streams'])
            if expected_audio != any(s['codec_type'] == 'audio' for s in output_info['streams']):
                raise ValueError('音轨核验失败')
            # Lock guards cooperating conversions; recheck protects pre-existing external outputs.
            if output.exists():
                raise ValueError('输出在转换期间被其他程序创建，未覆盖')
            os.link(final, output)  # Atomic no-clobber publication on the same volume.
            final.unlink()
            receipt = {'input': str(source), 'output': str(output), 'model': 'Video-Depth-Anything-Small',
                       'grayscale': True, 'near_bright_far_dark': True, 'metric_depth': False,
                       'fps': args.fps, 'input_size': args.input_size, 'working_max_res': args.max_res, 'audio': expected_audio,
                       'width': output_video['width'], 'height': output_video['height'],
                       'completed_at': time.time(), 'workflow_version': '1.0.0',
                       'checkpoint_sha256': sha256(checkpoint), 'source_sha256': sha256(source), **details, **verification}
            output.with_suffix('.depth.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
            progress('completed', **receipt)
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        progress('failed', error=str(error))
        sys.exit(1)
