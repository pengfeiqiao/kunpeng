#!/usr/bin/env python3
"""
generate-style-dna.py
=====================
为风格库 index.json 中的每个风格预生成结构化 DNA 字段：
  visualDNA / cameraLanguage / promptSuffix

单步流程：Perplexity 联网搜索 + 直接分析输出结构化 DNA（一次调用搞定）。

断点续跑：已有 visualDNA 的风格自动跳过。
"""

import json, time, re, sys, os, requests
from typing import Optional

import functools
print = functools.partial(print, flush=True)

# 密钥只从环境变量读取,不硬编码。请先在 shell 中:
#   export DMXAPI_API_KEY="sk-..."
API_KEY = os.environ.get("DMXAPI_API_KEY", "")
if not API_KEY:
    sys.exit("缺少 DMXAPI_API_KEY 环境变量")
BASE = "https://www.dmxapi.cn"
INDEX_PATH = os.path.join(os.path.dirname(__file__), "..", "aigc-memory", "style-library", "index.json")

BATCH_SIZE = 5
BATCH_DELAY = 2.0


def perplexity_analyze(query: str) -> str:
    """Perplexity 联网搜索 + 分析，一步到位"""
    url = f"{BASE}/v1/responses"
    headers = {"Content-Type": "application/json", "Authorization": API_KEY}
    body = {
        "model": "perplexity-sonar-pro-ssvip",
        "input": [{"role": "user", "content": [{"type": "input_text", "text": query}]}],
    }
    try:
        r = requests.post(url, json=body, headers=headers, timeout=120)
        r.raise_for_status()
        j = r.json()
        choices = j.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        return content.strip()
    except Exception as e:
        print(f"    [失败] {e}")
        return ""


def build_prompt(name: str, category: str, template: str) -> str:
    """构建给 Perplexity 的完整 prompt：搜索+分析一步完成"""
    cat_hint = "真人电影/电视剧" if category == "live-action" else "2D动画/插画/游戏"
    return f"""请先联网搜索「{name}」的摄影风格/美术设计专业资料，然后结合搜索结果和下面的示例提示词，提取结构化风格基因。

风格名称：{name}
类别：{cat_hint}
示例提示词（仅参考格式，不要照搬具体人物/场景描述）：
{template}

请严格按以下格式输出，每个要点要具体精准，体现该作品的真实专业特征（如摄影指导手法、实际胶片/镜头选择、标志性画面特征等）：

## visualDNA
- 色调：具体色彩组合与调色倾向（如"冷蓝偏绿、低饱和、暗角"而非"冷色调"）
- 光影：布光手法与光质特征（如"伦勃朗式侧光、硬朗阴影边缘"而非"暗调"）
- 构图：构图规律与画面空间感（如"严格中心对称、前景框架构图、留白上方1/3"）
- 场景风格：典型空间类型，不写具体场景

## cameraLanguage
- 景别：惯用景别范围和切换模式
- 拍摄角度：典型角度偏好
- 焦距/运镜：实际焦段偏好与运动方式（如"21mm Zeiss, Steadicam跟拍"）
- 转场：剪辑风格与节奏

## promptSuffix
一行英文逗号分隔关键词（8-15个），精准的AI绘图视觉标签

注意：
- {"2D动画/游戏风格重点在画风技法（线条粗细、上色方式、材质感），不强调真实摄影参数" if category != "live-action" else "真人电影重点在摄影指导的实际手法、胶片/镜头选择"}
- 不包含任何具体角色/人物/剧情描述
- 每个要点具体精准，避免泛泛而谈"""


def parse_dna(text: str) -> dict:
    """解析模型输出的 DNA 文本为结构化字段"""
    result = {"visualDNA": "", "cameraLanguage": "", "promptSuffix": ""}

    sections = re.split(r"##\s*", text)
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        lines = sec.split("\n", 1)
        header = lines[0].strip().lower()
        body = lines[1].strip() if len(lines) > 1 else ""

        if "visualdna" in header or "视觉基因" in header:
            result["visualDNA"] = body
        elif "cameralanguage" in header or "镜头语言" in header:
            result["cameraLanguage"] = body
        elif "promptsuffix" in header or "提示词后缀" in header or "英文" in header:
            clean = body.strip().strip("`").strip()
            clean = re.sub(r"^promptSuffix[：:]\s*", "", clean, flags=re.IGNORECASE)
            result["promptSuffix"] = clean

    return result


def process_style(style: dict) -> Optional[dict]:
    """处理单个风格，返回 DNA 或 None"""
    name = style["name"]
    category = style["category"]
    template = style.get("promptTemplate", "")

    prompt = build_prompt(name, category, template)
    print(f"  [Perplexity] 搜索+分析...")
    raw = perplexity_analyze(prompt)
    if not raw:
        return None

    dna = parse_dna(raw)
    if not dna["visualDNA"]:
        print(f"  [警告] 解析失败，原始输出前200字：{raw[:200]}")
        return None

    return dna


def main():
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    styles = data["styles"]
    total = len(styles)
    done = sum(1 for s in styles if s.get("visualDNA"))
    todo = [i for i, s in enumerate(styles) if not s.get("visualDNA")]

    print(f"共 {total} 个风格，已完成 {done}，待处理 {len(todo)}")

    if not todo:
        print("全部已完成！")
        return

    for batch_start in range(0, len(todo), BATCH_SIZE):
        batch = todo[batch_start:batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (len(todo) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\n=== 批次 {batch_num}/{total_batches} ===")

        for idx in batch:
            style = styles[idx]
            print(f"\n[{idx+1}/{total}] {style['name']} ({style['category']})")

            dna = process_style(style)
            if dna:
                styles[idx]["visualDNA"] = dna["visualDNA"]
                styles[idx]["cameraLanguage"] = dna["cameraLanguage"]
                styles[idx]["promptSuffix"] = dna["promptSuffix"]
                print(f"  [完成] visualDNA={len(dna['visualDNA'])}字, suffix={dna['promptSuffix'][:50]}...")
            else:
                print(f"  [失败] 跳过")

        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n  [保存] 已写入 index.json")

        if batch_start + BATCH_SIZE < len(todo):
            print(f"  等待 {BATCH_DELAY}s...")
            time.sleep(BATCH_DELAY)

    # 同步到 ~/.kunpeng/
    home_path = os.path.expanduser("~/.kunpeng/aigc-memory/style-library/index.json")
    home_dir = os.path.dirname(home_path)
    if os.path.isdir(home_dir):
        import shutil
        shutil.copy2(INDEX_PATH, home_path)
        print(f"\n已同步到 {home_path}")

    final_done = sum(1 for s in styles if s.get("visualDNA"))
    print(f"\n=== 完成 ===")
    print(f"成功：{final_done}/{total}")
    print(f"失败：{total - final_done}")


if __name__ == "__main__":
    main()
