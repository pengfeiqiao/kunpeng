#!/usr/bin/env python3
"""
Kuaizi/筷子丽帧 Seedance 2.0 CLI client for Kunpeng.

Dedicated to Seedance video generation via the Kuaizi LZ API.
For all other models, use runninghub.py instead.

Usage:
  python3 kuaizi.py --check
  python3 kuaizi.py --prompt "一只猫在奔跑" --mode pro --duration 5 -o /tmp/out.mp4
  python3 kuaizi.py --prompt "..." --image ref1.png --image ref2.png --mode fast -o /tmp/out.mp4
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

KUAIZI_BASE_URL = "https://aiopenapi.kuaizi.cn"
KUAIZI_CREATE_PATH = "/ai-open-platform-api/v1/lz/video/task/create"
KUAIZI_STATUS_PATH = "/ai-open-platform-api/v1/lz/video/task/status"

MAX_POLL_SECONDS = 1200
POLL_INTERVAL = 5

VALID_MODES = {"fast", "pro", "mini"}
VALID_RESOLUTIONS = {"480p", "720p", "1080p"}
VALID_RATIOS = {"16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"}
VALID_SUPER_RESOLUTIONS = {"720p", "1080p", "2k", "4k"}


# ---------------------------------------------------------------------------
# Config reading
# ---------------------------------------------------------------------------

def read_settings() -> dict:
    cfg_path = Path.home() / ".kunpeng" / "settings.json"
    if not cfg_path.exists():
        return {}
    try:
        return json.loads(cfg_path.read_text(encoding="utf-8")).get("state", {})
    except Exception:
        return {}


def get_kuaizi_api_key() -> str | None:
    key = read_settings().get("kuaiziApiKey", "")
    return key.strip() if key and key.strip() else None


def get_cos_transit_endpoint() -> str | None:
    ep = read_settings().get("cosTransitEndpoint", "")
    return ep.strip() if ep and ep.strip() else None


def require_api_key() -> str:
    key = get_kuaizi_api_key()
    if key:
        return key
    print(json.dumps({
        "error": "NO_API_KEY",
        "message": "筷子丽帧 API Key 未配置",
        "steps": [
            "1. 在鲲鹏设置 → API 密钥 → 视频生成 中填写筷子丽帧 API Key",
            "2. 或联系管理员获取 Key",
        ],
    }, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTTP helpers (curl-based, stdlib only)
# ---------------------------------------------------------------------------

def curl_post(url: str, payload: dict, headers: dict, timeout: int = 120) -> subprocess.CompletedProcess:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        tmp_path = f.name
    try:
        cmd = ["curl", "-s", "-S", "--fail-with-body", "-X", "POST", url,
               "--max-time", str(timeout), "-d", f"@{tmp_path}"]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        return subprocess.run(cmd, capture_output=True, text=True)
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Media upload
# ---------------------------------------------------------------------------

def image_to_data_uri(file_path: str) -> str:
    mime_type = mimetypes.guess_type(file_path)[0] or "image/png"
    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode()
    return f"data:{mime_type};base64,{encoded}"


def cos_transit_upload(file_path: str, cos_endpoint: str) -> str | None:
    """Upload a local file to COS via SCF transit, return public URL."""
    path = Path(file_path)
    mime = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    file_name = f"kuaizi-ref-{int(time.time())}_{path.name}"
    with open(file_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    upload_payload = json.dumps({
        "url": f"data:{mime};base64,{img_b64}",
        "fileName": file_name,
        "contentType": mime,
    })
    result = subprocess.run(
        ["curl", "-s", "-S", "--fail-with-body", "-X", "POST", cos_endpoint,
         "-H", "Content-Type: application/json",
         "-d", upload_payload, "--max-time", "120"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        try:
            resp = json.loads(result.stdout)
            cos_url = resp.get("cosUrl")
            if cos_url:
                return cos_url
        except json.JSONDecodeError:
            pass
    return None


def resolve_media(file_path: str, cos_endpoint: str | None) -> str:
    """Resolve a local file or URL to a public URL for Kuaizi API."""
    if file_path.startswith(("http://", "https://")):
        return file_path
    path = Path(file_path)
    if not path.exists():
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    if cos_endpoint:
        print(f"Uploading {path.name} via COS transit...", file=sys.stderr)
        cos_url = cos_transit_upload(file_path, cos_endpoint)
        if cos_url:
            print(f"Upload OK: {cos_url[:80]}...", file=sys.stderr)
            return cos_url
        print(f"COS transit failed, falling back to data URI", file=sys.stderr)
    return image_to_data_uri(file_path)


# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def cos_transit_download(remote_url: str, file_name: str) -> str | None:
    endpoint = get_cos_transit_endpoint()
    if not endpoint:
        return None
    payload = json.dumps({"url": remote_url, "fileName": file_name, "contentType": "video/mp4"})
    cmd = [
        "curl", "-s", "-S", "--fail-with-body", "-X", "POST", endpoint,
        "-H", "Content-Type: application/json",
        "-d", payload,
        "--max-time", "360",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        resp = json.loads(result.stdout)
        return resp.get("cosUrl")
    except json.JSONDecodeError:
        return None


def download_file(url: str, output_path: str) -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    download_url = url
    file_name = f"kuaizi_{int(time.time())}_{Path(output_path).name}"
    print("Attempting COS transit for video...", file=sys.stderr)
    cos_url = cos_transit_download(url, file_name)
    if cos_url:
        download_url = cos_url

    timeout = "120" if download_url != url else "600"
    cmd = ["curl", "-s", "-S", "-L", "-o", output_path, "--max-time", timeout, download_url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        if download_url != url:
            print("COS download failed, retrying direct...", file=sys.stderr)
            cmd = ["curl", "-s", "-S", "-L", "-o", output_path, "--max-time", "600", url]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"Download failed: {result.stderr}", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Download failed: {result.stderr}", file=sys.stderr)
            sys.exit(1)
    return str(Path(output_path).resolve())


def fix_mov_to_mp4(file_path: str) -> bool:
    try:
        with open(file_path, "rb") as f:
            header = f.read(64)
    except OSError:
        return False
    if len(header) < 16:
        return False
    box_size = struct.unpack(">I", header[0:4])[0]
    if header[4:8] != b"ftyp" or box_size < 16 or box_size > len(header):
        return False
    if header[8:12] != b"qt  ":
        return False
    minor_version = header[12:16]
    brands = [b"isom", b"iso2", b"avc1", b"mp41"]
    max_brands = (box_size - 16) // 4
    used_brands = brands[:max_brands]
    new_ftyp = struct.pack(">I", box_size) + b"ftyp" + b"isom" + minor_version
    for b in used_brands:
        new_ftyp += b
    new_ftyp += b"\x00" * (box_size - len(new_ftyp))
    with open(file_path, "r+b") as f:
        f.write(new_ftyp)
    print(f"Fixed MOV→MP4 container: {Path(file_path).name}", file=sys.stderr)
    return True


# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------

def cmd_check():
    key = get_kuaizi_api_key()
    if not key:
        print(json.dumps({
            "status": "no_key",
            "message": "筷子丽帧 API Key 未配置",
            "steps": [
                "1. 在鲲鹏设置 → API 密钥 → 视频生成 中填写筷子丽帧 API Key",
            ],
        }, ensure_ascii=False))
        return
    key_prefix = key[:4] + "****"
    cos_ep = get_cos_transit_endpoint()
    print(json.dumps({
        "status": "ready",
        "key_prefix": key_prefix,
        "cos_transit": "configured" if cos_ep else "not_configured",
        "message": "筷子丽帧 API Key 已配置",
    }, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Main generation flow
# ---------------------------------------------------------------------------

def cmd_generate(args):
    api_key = require_api_key()
    cos_endpoint = get_cos_transit_endpoint()

    # Parse extra --param key=value pairs
    extra_params = {}
    if args.param:
        for p in args.param:
            if "=" not in p:
                continue
            k, v = p.split("=", 1)
            extra_params[k] = v

    # Resolve mode
    mode = args.mode or extra_params.get("mode", "pro")
    if mode not in VALID_MODES:
        mode = "pro"

    # Resolve resolution
    resolution = args.resolution or extra_params.get("resolution", "720p")
    super_resolution_config = None
    if resolution in ("2k", "4k"):
        super_resolution_config = {
            "resolution": resolution,
            "scene": "aigc",
            "tool_version": "standard",
        }
        resolution = "1080p"
    elif resolution not in VALID_RESOLUTIONS:
        resolution = "720p"

    # Validate mode/resolution combos
    if mode in ("fast", "mini") and resolution == "1080p" and not super_resolution_config:
        print(f"Warning: {mode} mode doesn't support 1080p natively, using 720p", file=sys.stderr)
        resolution = "720p"

    # Resolve ratio
    ratio = args.ratio or extra_params.get("ratio", extra_params.get("aspectRatio", "16:9"))
    if ratio not in VALID_RATIOS:
        ratio = "16:9"

    # Resolve duration
    duration = args.duration
    if duration is None:
        try:
            duration = int(extra_params.get("duration", "5"))
        except ValueError:
            duration = 5
    if duration != -1:
        duration = max(4, min(15, duration))

    # Upload media references
    image_items = []
    if args.image:
        for i, img_path in enumerate(args.image[:9]):
            print(f"Uploading reference image {i+1}/{len(args.image)}...", file=sys.stderr)
            url = resolve_media(img_path, cos_endpoint)
            role = "reference_image"
            if extra_params.get(f"image_role_{i}"):
                role = extra_params[f"image_role_{i}"]
            elif i == 0 and extra_params.get("first_frame", "").lower() == "true":
                role = "first_frame"
            image_items.append({"url": url, "role": role})

    video_items = []
    if args.video:
        for vid_path in args.video[:3]:
            print(f"Uploading reference video...", file=sys.stderr)
            url = resolve_media(vid_path, cos_endpoint)
            video_items.append({"url": url, "role": "reference_video"})

    audio_items = []
    if args.audio:
        for aud_path in args.audio[:3]:
            print(f"Uploading reference audio...", file=sys.stderr)
            url = resolve_media(aud_path, cos_endpoint)
            audio_items.append({"url": url, "role": "reference_audio"})

    # Build payload
    generate_audio = True
    if extra_params.get("generate_audio", "").lower() == "false" or args.no_generate_audio:
        generate_audio = False

    watermark = False
    if extra_params.get("watermark", "").lower() == "true":
        watermark = True

    has_ref_images = any(
        item.get("role") in ("reference_image", "first_frame")
        for item in image_items
    )
    return_last_frame = not has_ref_images
    if extra_params.get("return_last_frame", "").lower() == "true":
        return_last_frame = True
    elif extra_params.get("return_last_frame", "").lower() == "false":
        return_last_frame = False

    payload: dict = {
        "prompt": args.prompt or "",
        "mode": mode,
        "resolution": resolution,
        "ratio": ratio,
        "duration": duration,
        "generate_audio": generate_audio,
        "watermark": watermark,
        "return_last_frame": return_last_frame,
        "execution_expires_after": int(extra_params.get("execution_expires_after", "172800")),
    }

    if image_items:
        payload["images"] = image_items
    if video_items:
        payload["videos"] = video_items
    if audio_items:
        payload["audios"] = audio_items
    if super_resolution_config:
        payload["super_resolution_config"] = super_resolution_config
    if args.super_resolution:
        sr = args.super_resolution
        if sr in VALID_SUPER_RESOLUTIONS:
            payload["super_resolution_config"] = {
                "resolution": sr,
                "scene": extra_params.get("sr_scene", "aigc"),
                "tool_version": extra_params.get("sr_tool_version", "standard"),
            }

    if "seed" in extra_params:
        payload["seed"] = extra_params["seed"]
    if "bitrate_mode" in extra_params:
        payload["bitrate_mode"] = extra_params["bitrate_mode"]

    # Submit task
    print(f"Submitting Seedance via 筷子丽帧 (mode={mode}, {resolution}, {ratio}, {duration}s)...", file=sys.stderr)

    headers = {
        "Content-Type": "application/json",
        "ApiKey": api_key,
    }
    result = curl_post(f"{KUAIZI_BASE_URL}{KUAIZI_CREATE_PATH}", payload, headers)

    if result.returncode != 0:
        error_body = result.stdout or result.stderr
        if "429" in error_body or "40001" in error_body:
            print(json.dumps({
                "error": "INSUFFICIENT_BALANCE",
                "message": f"筷子丽帧余额不足: {error_body[:300]}",
            }, ensure_ascii=False), file=sys.stderr)
        else:
            print(f"Kuaizi create task failed: {error_body[:500]}", file=sys.stderr)
        sys.exit(1)

    try:
        resp = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"Kuaizi invalid JSON: {result.stdout[:300]}", file=sys.stderr)
        sys.exit(1)

    if resp.get("code") != 0 or not resp.get("data", {}).get("task_id"):
        msg = resp.get("message", json.dumps(resp)[:300])
        print(f"Kuaizi task rejected: {msg}", file=sys.stderr)
        sys.exit(1)

    task_id = resp["data"]["task_id"]
    print(f"Task ID: {task_id} (筷子丽帧)")
    print("Waiting for result", end="", flush=True)

    # Poll for completion
    elapsed = 0
    consecutive_failures = 0
    while elapsed < MAX_POLL_SECONDS:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        poll_result = curl_post(
            f"{KUAIZI_BASE_URL}{KUAIZI_STATUS_PATH}",
            {"task_id": task_id},
            headers,
            timeout=30,
        )

        if poll_result.returncode != 0:
            consecutive_failures += 1
            print("x", end="", flush=True)
            if consecutive_failures >= 10:
                print(f"\nToo many consecutive poll failures", file=sys.stderr)
                sys.exit(1)
            continue

        consecutive_failures = 0
        try:
            status_resp = json.loads(poll_result.stdout)
        except json.JSONDecodeError:
            print("x", end="", flush=True)
            continue

        status_data = status_resp.get("data", {})
        status = status_data.get("status", "unknown")

        if status == "succeeded":
            print(f" done ({elapsed}s)")
            video_url = status_data.get("video_url")
            if not video_url:
                print("Error: Kuaizi succeeded but no video_url", file=sys.stderr)
                sys.exit(1)

            output_path = args.output
            if not output_path:
                output_path = f"/tmp/kunpeng/rh-output/seedance_{int(time.time())}.mp4"
            output_path = str(Path(output_path).with_suffix(".mp4"))

            print("Downloading result...", file=sys.stderr)
            full_path = download_file(video_url, output_path)
            fix_mov_to_mp4(full_path)
            print(f"OUTPUT_FILE:{full_path}")

            # Print extra info
            seed = status_data.get("seed")
            duration_out = status_data.get("duration")
            if seed:
                print(f"SEED:{seed}")
            if duration_out:
                print(f"VIDEO_DURATION:{duration_out}s")

            last_frame = status_data.get("last_frame_url")
            if last_frame:
                print(f"LAST_FRAME_URL:{last_frame}")
            return

        if status == "failed":
            error_msg = status_data.get("error", "unknown error")
            print(f"\nKuaizi task failed: {error_msg}", file=sys.stderr)
            sys.exit(1)

        print(".", end="", flush=True)

    print(f"\nTimeout after {MAX_POLL_SECONDS}s", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Kuaizi/筷子丽帧 Seedance 2.0 video generation client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python3 kuaizi.py --check
  python3 kuaizi.py --prompt "一只猫在奔跑" --mode fast --duration 5 -o /tmp/cat.mp4
  python3 kuaizi.py --prompt "cinematic shot" --image ref.png --mode pro -o /tmp/out.mp4
  python3 kuaizi.py --prompt "..." --image a.png --image b.png --audio bgm.mp3 --mode pro
  python3 kuaizi.py --prompt "..." --mode pro --resolution 720p --super-resolution 4k
""",
    )

    parser.add_argument("--check", action="store_true", help="Check API key status")
    parser.add_argument("--prompt", "-p", help="Video generation prompt")
    parser.add_argument("--mode", "-m", choices=["fast", "pro", "mini"], help="Generation mode (default: pro)")
    parser.add_argument("--image", "-i", action="append", help="Reference image path/URL (repeatable, max 9)")
    parser.add_argument("--video", action="append", help="Reference video path/URL (repeatable, max 3)")
    parser.add_argument("--audio", action="append", help="Reference audio path/URL (repeatable, max 3)")
    parser.add_argument("--resolution", choices=["480p", "720p", "1080p", "2k", "4k"],
                        help="Output resolution (default: 720p). 2k/4k use chain upscaling")
    parser.add_argument("--ratio", choices=["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"],
                        help="Aspect ratio (default: 16:9)")
    parser.add_argument("--duration", "-d", type=int, help="Duration in seconds (4-15, or -1 for auto)")
    parser.add_argument("--no-generate-audio", action="store_true", help="Disable auto audio generation")
    parser.add_argument("--super-resolution", choices=["720p", "1080p", "2k", "4k"],
                        help="Chain super-resolution target")
    parser.add_argument("--param", action="append", help="Extra parameter as key=value (repeatable)")
    parser.add_argument("--output", "-o", help="Output file path")

    args = parser.parse_args()

    if args.check:
        cmd_check()
    elif args.prompt is not None:
        cmd_generate(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
