#!/usr/bin/env python3
"""
分镜草图生成器 - 从视频关键帧生成铅笔手绘风格的分镜草图
"""
import os
import sys
import base64
import re
import json
import requests
from pathlib import Path


API_KEY = os.environ.get("DMXAPI_KEY", "")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
MODEL_FLASH = "gpt-image-2"
MODEL_PRO = "gpt-image-2"


def load_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def generate_sketch(input_path, output_path, shot_number=1, shot_type="MS", 
                    camera_angle="eye level", label="", model=MODEL_FLASH):
    """从关键帧生成分镜草图"""
    
    prompt = f"""Based on this film frame, create a STORYBOARD SKETCH — the kind a storyboard artist would draw quickly with pencil on paper.

STYLE: Loose pencil sketch on white paper, slightly rough hand-drawn quality, like a cinematographer's storyboard. NOT a detailed illustration, NOT photorealistic. Think quick gestural drawing.

SHOT INFO: SHOT {shot_number:02d} — {shot_type} — {camera_angle}
{f"LABEL: {label}" if label else ""}

INCLUDE these elements with simple pencil strokes:
1. The basic environment layout: walls, floors, key architectural elements
2. A simple seated/standing figure (just silhouette/outline, NO facial details, NO recognizable features)
3. Key props as simple shapes (tables, chairs, vehicles, etc.)
4. Light direction arrow (yellow) showing the main light source
5. Camera position indicator (small triangle below frame with dotted sightline)
6. A label in the corner: "SHOT {shot_number:02d} — {shot_type} — {camera_angle}"
{f"7. Text label showing: {label}" if label else ""}

DO NOT:
- Draw any recognizable facial features
- Copy any textures, colors, or specific details from the original
- Make it look like a finished illustration
- Add any color or shading (pencil gray tones only)

DO:
- Capture the SPATIAL LAYOUT and COMPOSITION faithfully
- Show where each element is positioned in the frame
- Keep it simple, loose, and sketch-like
- Show the camera angle and framing accurately
- Use only pencil-gray tones on white paper

This should look like something drawn in 2 minutes by a storyboard artist during a production meeting."""

    content = [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{load_b64(input_path)}"}},
        {"type": "text", "text": prompt}
    ]
    
    resp = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": 4096},
        timeout=180
    )
    
    r = resp.json()
    if "choices" in r:
        text = r["choices"][0]["message"]["content"]
        m = re.search(r'data:image/(\w+);base64,([A-Za-z0-9+/=]+)', text)
        if m:
            fmt = m.group(1)
            b64 = m.group(2)
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(base64.b64decode(b64))
            print(f"✅ 草图已保存: {output_path} ({os.path.getsize(output_path)/1024:.1f}KB)")
            return output_path
    
    print(f"❌ 生成失败: {str(r)[:300]}")
    return None


def generate_shot(sketch_path, character_path, output_path, 
                  scene_desc="", lighting_desc="Cool overcast daylight (6500K)",
                  color_grading="cool blue-gray, desaturated", mood="cinematic",
                  model=MODEL_PRO):
    """用草图+人物参考生成分镜成片"""
    
    prompt = f"""You are a cinematographer recreating a shot from a storyboard sketch.

STRICT INSTRUCTION: The storyboard sketch (first image) is your DIRECTOR'S SHOT PLAN. You must follow it PRECISELY. Every element's position, size, and framing must match the sketch.

STEP 1 - ANALYZE THE SKETCH FIRST:
Look at the storyboard sketch and identify:
- Where exactly is the person positioned in the frame?
- How much of the frame does the person occupy?
- Where are key props and scene elements?
- What is the camera angle?
- Where is the negative space?
- What does the light direction arrow indicate?

STEP 2 - FOLLOW THE SKETCH EXACTLY:
- Place the person at the EXACT same position as the figure in the sketch
- Match all element positions, sizes, and angles from the sketch
- Same camera angle, same negative space distribution
- Do NOT reposition, reframe, or add/remove elements

STEP 3 - APPLY THE CHARACTER:
Use the woman from the second reference image (character sheet). Her face and outfit must be identical.

STEP 4 - RENDER THE SCENE:
Scene: {scene_desc}
Lighting: {lighting_desc}
Color grading: {color_grading}
Mood: {mood}
Style: Realistic cinematic photography, 16:9 widescreen, subtle film grain

AGAIN: The sketch is your shot plan. Match it precisely.
NO TEXT, NO WATERMARK, NO SUBTITLES"""

    content = [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{load_b64(sketch_path)}"}},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{load_b64(character_path)}"}},
        {"type": "text", "text": prompt}
    ]
    
    resp = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": 4096},
        timeout=300
    )
    
    r = resp.json()
    if "choices" in r:
        text = r["choices"][0]["message"]["content"]
        m = re.search(r'data:image/(\w+);base64,([A-Za-z0-9+/=]+)', text)
        if m:
            fmt = m.group(1)
            b64 = m.group(2)
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(base64.b64decode(b64))
            print(f"✅ 分镜已保存: {output_path} ({os.path.getsize(output_path)/1024:.1f}KB)")
            return output_path
    
    print(f"❌ 生成失败: {str(r)[:300]}")
    return None


def main():
    import argparse
    parser = argparse.ArgumentParser(description="分镜草图生成器")
    sub = parser.add_subparsers(dest="command")
    
    # sketch command
    sk = sub.add_parser("sketch", help="生成草图")
    sk.add_argument("--input", "-i", required=True, help="关键帧图片路径")
    sk.add_argument("--output", "-o", required=True, help="输出草图路径")
    sk.add_argument("--shot-number", "-n", type=int, default=1, help="镜头编号")
    sk.add_argument("--shot-type", "-t", default="MS", help="景别 (MS/WS/CU等)")
    sk.add_argument("--camera-angle", "-c", default="eye level", help="机位")
    sk.add_argument("--label", "-l", default="", help="额外标注")
    sk.add_argument("--model", "-m", default=MODEL_FLASH, help="模型")
    
    # shot command
    sh = sub.add_parser("shot", help="用草图生成分镜")
    sh.add_argument("--sketch", "-s", required=True, help="草图路径")
    sh.add_argument("--character", "-ch", required=True, help="人物参考图路径")
    sh.add_argument("--output", "-o", required=True, help="输出路径")
    sh.add_argument("--scene", default="", help="场景描述")
    sh.add_argument("--lighting", default="Cool overcast daylight (6500K)", help="光线描述")
    sh.add_argument("--color-grading", default="cool blue-gray, desaturated", help="色调")
    sh.add_argument("--mood", default="cinematic", help="氛围")
    sh.add_argument("--style-profile", default="", help="style_profile.json路��，覆盖lighting/color-grading/mood")
    sh.add_argument("--model", "-m", default=MODEL_PRO, help="模型")
    
    # batch sketch command
    bs = sub.add_parser("batch-sketch", help="批量生成草图")
    bs.add_argument("--input-dir", "-i", required=True, help="关键帧目录")
    bs.add_argument("--output-dir", "-o", required=True, help="输出目录")
    bs.add_argument("--model", "-m", default=MODEL_FLASH, help="模型")
    
    args = parser.parse_args()
    
    if args.command == "sketch":
        generate_sketch(args.input, args.output, args.shot_number, args.shot_type, 
                       args.camera_angle, args.label, args.model)
    elif args.command == "shot":
        lighting = args.lighting
        color_grading = args.color_grading
        mood = args.mood
        if args.style_profile and os.path.isfile(args.style_profile):
            with open(args.style_profile, "r", encoding="utf-8") as f:
                sp = json.load(f)
            lighting = sp.get("lighting", lighting)
            color_grading = sp.get("colorGrading", sp.get("color_grading", color_grading))
            mood = sp.get("mood", mood)
            print(f"📋 使用风格档案: {args.style_profile}")
        generate_shot(args.sketch, args.character, args.output, args.scene,
                     lighting, color_grading, mood, args.model)
    elif args.command == "batch-sketch":
        frames = sorted(Path(args.input_dir).glob("*.jpg"))
        os.makedirs(args.output_dir, exist_ok=True)
        for i, f in enumerate(frames, 1):
            print(f"\n[{i}/{len(frames)}] {f.name}")
            generate_sketch(str(f), os.path.join(args.output_dir, f"shot_{i:02d}_sketch.jpg"), 
                          shot_number=i, model=args.model)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
