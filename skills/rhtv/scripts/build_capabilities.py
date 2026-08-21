#!/usr/bin/env python3
"""
Build capabilities.json from ComfyUI_RH_OpenAPI models_registry.json.

Usage:
    python build_capabilities.py --registry /path/to/models_registry.json --output ../data/capabilities.json
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

# Popularity overrides: endpoint → rank (1 = most popular).
# Within each task group, endpoints not listed here get rank 99.
POPULARITY_OVERRIDES = {
    # Image - text-to-image
    "rhart-image-n-pro/text-to-image": 1,
    "rhart-image-g-1.5/text-to-image": 2,
    "rhart-image-g-3/text-to-image": 3,
    "rhart-image-g-4/text-to-image": 4,
    "rhart-image-n-g31-flash/text-to-image": 5,
    "rhart-image-n-pro-official/text-to-image": 6,
    "rhart-image-n-pro-official/text-to-image-ultra": 7,
    "seedream-v5-lite/text-to-image": 8,
    "seedream-v4.5/text-to-image": 9,
    "seedream-v4/text-to-image": 10,
    "rhart-image-v1/text-to-image": 11,
    "rhart-image-v1-official/text-to-image": 12,
    "rhart-image-g/text-to-image": 13,
    "youchuan/text-to-image-v7": 14,
    "youchuan/text-to-image-niji7": 15,
    "youchuan/text-to-image-v6": 16,
    "youchuan/text-to-image-v61": 17,
    "youchuan/text-to-image-niji6": 18,
    "youchuan/text-to-image-v81": 13,
    "youchuan/text-to-image-v7": 14,
    "youchuan/text-to-image-niji7": 15,
    "youchuan/text-to-image-v6": 16,
    "youchuan/text-to-image-v61": 17,
    "youchuan/text-to-image-niji6": 18,
    "rhart-image-n-g31-flash-official/text-to-image": 19,
    "rhart-image-g-1.5-official/text-to-image": 20,

    # Image - image-to-image / edit
    "rhart-image-n-pro/edit": 1,
    "rhart-image-g-1.5/edit": 2,
    "rhart-image-g-3/image-to-image": 3,
    "rhart-image-g-4/image-to-image": 4,
    "rhart-image-n-g31-flash/image-to-image": 5,
    "rhart-image-n-pro-official/edit": 6,
    "rhart-image-n-pro-official/edit-ultra": 7,
    "seedream-v5-lite/image-to-image": 8,
    "seedream-v4.5/image-to-image": 9,
    "seedream-v4/image-to-image": 10,
    "rhart-image-v1/edit": 11,
    "alibaba/qwen-image-2.0-pro/image-edit": 12,
    "alibaba/qwen-image-2.0/image-edit": 13,

    # Image - upscale
    "topazlabs/image-upscale-standard-v2": 1,
    "topazlabs/image-upscale-high-fidelity-v2": 2,
    "topazlabs/image-upscale/low-resolution-v2": 3,
    "topazlabs/image-upscale-cgi": 4,
    "topazlabs/image-upscale-text-refine": 5,

    # Video - text-to-video
    "rhart-video-s/text-to-video": 1,
    "rhart-video-s/text-to-video-pro": 2,
    "rhart-video-s-official/text-to-video": 3,
    "rhart-video-s-official/text-to-video-pro": 4,
    "kling-v3.0-pro/text-to-video": 5,
    "kling-v3.0-std/text-to-video": 6,
    "kling-video-o3-pro/text-to-video": 7,
    "kling-video-o3-std/text-to-video": 8,
    "kling-video-o1/text-to-video": 9,
    "kling-v2.6-pro/text-to-video": 10,
    "kling-v2.5-turbo-pro/text-to-video": 11,
    "rhart-video-v3.1-pro/text-to-video": 12,
    "rhart-video-v3.1-fast/text-to-video": 13,
    "rhart-video-v3.1-pro-official/text-to-video": 14,
    "rhart-video-v3.1-fast-official/text-to-video": 15,
    "rhart-video-g/text-to-video": 16,
    "rhart-video-g-official/text-to-video": 17,
    "minimax/hailuo-02/t2v-pro": 18,
    "minimax/hailuo-2.3/t2v-pro": 19,
    "minimax/hailuo-02/t2v-standard": 20,
    "minimax/hailuo-2.3/t2v-standard": 21,
    "vidu/text-to-video-q3-pro": 22,
    "vidu/text-to-video-q3-turbo": 23,
    "vidu/text-to-video": 24,
    "alibaba/wan-2.6/text-to-video": 25,
    "seedance-v1.5-pro/text-to-video": 26,
    "seedance-v1.5-pro/text-to-video-fast": 27,

    # Video - image-to-video
    "rhart-video-s/image-to-video": 1,
    "rhart-video-s/image-to-video-pro": 2,
    "rhart-video-s-official/image-to-video": 3,
    "rhart-video-s-official/image-to-video-pro": 4,
    "rhart-video-s-official/image-to-video-realistic": 5,
    "kling-v3.0-pro/image-to-video": 6,
    "kling-v3.0-std/image-to-video": 7,
    "kling-video-o3-pro/image-to-video": 8,
    "kling-video-o3-std/image-to-video": 9,
    "kling-video-o1/image-to-video": 10,
    "kling-v2.6-pro/image-to-video": 11,
    "kling-v2.5-turbo-pro/image-to-video": 12,
    "kling-v2.5-turbo-std/image-to-video": 13,
    "rhart-video-v3.1-pro/image-to-video": 14,
    "rhart-video-v3.1-fast/image-to-video": 15,
    "rhart-video-v3.1-pro-official/image-to-video": 16,
    "rhart-video-v3.1-fast-official/image-to-video": 17,
    "rhart-video-g/image-to-video": 18,
    "rhart-video-g-official/image-to-video": 19,
    "minimax/hailuo-02/i2v-pro": 20,
    "minimax/hailuo-02/i2v-standard": 21,
    "minimax/hailuo-2.3/i2v-standard": 22,
    "minimax/hailuo-2.3/image-to-video-pro": 23,
    "minimax/hailuo-2.3-fast/image-to-video": 24,
    "minimax/hailuo-2.3-fast-pro/image-to-video": 25,
    "vidu/image-to-video-q3-pro": 26,
    "vidu/image-to-video-q3-turbo": 27,
    "vidu/image-to-video-q2-pro": 28,
    "vidu/image-to-video-q2-pro-fast": 29,
    "vidu/image-to-video-q2-turbo": 30,
    "alibaba/wan-2.6/image-to-video": 31,
    "alibaba/wan-2.6/image-to-video-flash": 32,
    "seedance-v1.5-pro/image-to-video": 33,
    "seedance-v1.5-pro/image-to-video-fast": 34,
    "youchuan/image-to-video": 35,

    # Audio
    "rhart-audio/text-to-audio/speech-2.8-hd": 1,
    "rhart-audio/text-to-audio/speech-02-hd": 2,
    "rhart-audio/text-to-audio/speech-2.8-turbo": 3,
    "rhart-audio/text-to-audio/speech-02-turbo": 4,
    "rhart-audio/text-to-audio/speech-2.6-hd": 5,
    "rhart-audio/text-to-audio/speech-2.6-turbo": 6,
    "rhart-audio/text-to-audio/music-2.5": 7,
    "rhart-audio/text-to-audio/voice-clone": 8,

    # 3D
    "hunyuan3d-v3.1/image-to-3d": 1,
    "hunyuan3d-v3.1/text-to-3d": 2,
}


def extract_task(endpoint: str, output_type: str) -> str:
    """Derive a normalized task name from the endpoint path."""
    parts = endpoint.split("/")
    suffix = parts[-1] if len(parts) > 1 else endpoint

    # Normalize common patterns
    if "upscale" in suffix or "upscale" in endpoint:
        if output_type == "video":
            return "video-upscale"
        return "image-upscale"
    if suffix in ("edit", "edit-ultra"):
        return "image-to-image"
    if "image-edit" in suffix:
        return "image-to-image"
    if "image-to-image" in suffix:
        return "image-to-image"
    if "text-to-image" in suffix:
        return "text-to-image"
    if "text-to-video" in suffix or "t2v" in suffix:
        return "text-to-video"
    if "image-to-video" in suffix or "i2v" in suffix:
        return "image-to-video"
    if "start-end" in suffix or "start-to-end" in suffix:
        return "start-end-to-video"
    if "reference-to-video" in suffix or "refrence-to-video" in suffix:
        return "reference-to-video"
    if "video-extend" in suffix:
        return "video-extend"
    if "edit-video" in suffix or "video-edit" in suffix:
        return "video-edit"
    if "motion-control" in suffix:
        return "motion-control"
    if "text-to-3d" in suffix:
        return "text-to-3d"
    if "multi-image-to-3d" in suffix:
        return "multi-image-to-3d"
    if "image-to-3d" in suffix:
        return "image-to-3d"
    if "text-to-text" in suffix:
        return "text-to-text"
    if "image-to-text" in suffix:
        return "image-to-text"
    if "video-to-text" in suffix:
        return "video-to-text"
    if "speech" in suffix or "speech" in endpoint:
        return "text-to-speech"
    if "music" in suffix:
        return "music-generation"
    if "voice-clone" in suffix:
        return "voice-clone"
    if "upload-character" in suffix:
        return "upload-character"

    # Fallback: if output_type gives a clue
    if output_type == "video":
        return "video-other"
    if output_type == "image":
        return "image-other"
    if output_type == "audio":
        return "audio-other"
    return "other"


def extract_tags(endpoint: str, name_cn: str, output_type: str, task: str) -> list:
    """Generate descriptive tags for routing."""
    tags = []

    if "official" in endpoint:
        tags.append("official")
    if "pro" in endpoint.split("/")[-1] or "-pro" in endpoint:
        tags.append("pro")
    if "fast" in endpoint or "turbo" in endpoint or "flash" in endpoint:
        tags.append("fast")
    if "ultra" in endpoint:
        tags.append("ultra-quality")
    if "realistic" in endpoint or "真人" in name_cn:
        tags.append("realistic")
    if "niji" in endpoint:
        tags.append("anime")
    if "youchuan" in endpoint:
        tags.append("midjourney-style")
    if "topazlabs" in endpoint:
        tags.append("enhance")
    if "std" in endpoint.split("/")[-1] or "-std" in endpoint:
        tags.append("standard")
    if "hd" in endpoint.split("/")[-1]:
        tags.append("hd")

    return tags


def simplify_param(param: dict) -> dict:
    """Extract essential param info for capabilities.json."""
    p = {
        "key": param["fieldKey"],
        "type": param["type"],
        "required": param.get("required", False),
    }
    if param.get("options"):
        p["options"] = [opt["value"] for opt in param["options"]]
    default_val = param.get("defaultValue")
    if default_val is not None and default_val != "":
        if isinstance(default_val, str) and ("Rh-Comfy-Auth=" in default_val or "Rh-Identify=" in default_val):
            pass
        else:
            p["default"] = default_val
    if param.get("multipleInputs"):
        p["multiple"] = True
        if param.get("maxInputNum"):
            p["maxCount"] = param["maxInputNum"]
    if param.get("maxLength"):
        p["maxLength"] = param["maxLength"]
    if param.get("maxSize"):
        p["maxSizeMB"] = param["maxSize"]
    if param.get("min") is not None:
        p["min"] = param["min"]
    if param.get("max") is not None:
        p["max"] = param["max"]
    return p


def build_capabilities(registry: list) -> dict:
    """Transform models_registry.json entries into capabilities.json."""
    endpoints = []

    for entry in registry:
        ep = entry["endpoint"]
        output_type = entry["output_type"]
        task = extract_task(ep, output_type)

        cap = {
            "endpoint": ep,
            "name_cn": entry.get("name_cn", ""),
            "name_en": entry.get("name_en", ""),
            "task": task,
            "output_type": output_type,
            "category": entry.get("category", ""),
            "popularity": POPULARITY_OVERRIDES.get(ep, 99),
            "tags": extract_tags(ep, entry.get("name_cn", ""), output_type, task),
            "params": [simplify_param(p) for p in entry.get("params", [])],
        }
        endpoints.append(cap)

    # Sort: by task, then by popularity within each task
    endpoints.sort(key=lambda x: (x["task"], x["popularity"]))

    return {
        "version": date.today().isoformat(),
        "total": len(endpoints),
        "endpoints": endpoints,
    }


def main():
    parser = argparse.ArgumentParser(description="Build capabilities.json from models_registry.json")
    parser.add_argument("--registry", "-r", required=True, help="Path to models_registry.json")
    parser.add_argument("--output", "-o", required=True, help="Output path for capabilities.json")
    args = parser.parse_args()

    registry_path = Path(args.registry)
    if not registry_path.exists():
        print(f"Error: registry not found: {registry_path}", file=sys.stderr)
        sys.exit(1)

    with open(registry_path, encoding="utf-8") as f:
        registry = json.load(f)

    print(f"Read {len(registry)} entries from {registry_path}")

    capabilities = build_capabilities(registry)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(capabilities, f, indent=2, ensure_ascii=False)

    # Summary
    from collections import Counter
    task_counts = Counter(e["task"] for e in capabilities["endpoints"])
    type_counts = Counter(e["output_type"] for e in capabilities["endpoints"])

    print(f"\nGenerated {output_path} with {capabilities['total']} endpoints")
    print(f"\nBy output_type:")
    for t, c in type_counts.most_common():
        print(f"  {t}: {c}")
    print(f"\nBy task:")
    for t, c in task_counts.most_common():
        print(f"  {t}: {c}")

    ranked = sum(1 for e in capabilities["endpoints"] if e["popularity"] < 99)
    print(f"\n{ranked} endpoints have explicit popularity rankings")


if __name__ == "__main__":
    main()
