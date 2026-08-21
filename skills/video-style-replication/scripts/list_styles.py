#!/usr/bin/env python3
"""查看已保存的所有风格"""
import json
from pathlib import Path

DESKTOP_STYLE_DIR = Path.home() / "Desktop" / "视频复刻"
INDEX_PATH = DESKTOP_STYLE_DIR / "index.json"

def main():
    if not INDEX_PATH.exists():
        print("❌ 还没有保存任何风格")
        print(f"💡 提示: 请使用 analyze_style.py 创建第一个风格")
        return
    
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index = json.load(f)
    
    if not index.get("styles"):
        print("❌ 没有保存任何风格")
        return
    
    print("\n" + "="*60)
    print(f"已保存的风格（共 {len(index['styles'])} 个）")
    print("="*60 + "\n")
    
    for i, style in enumerate(index["styles"], 1):
        print(f"{i}. {style['name']}")
        print(f"   路径: {style['path']}")
        print(f"   创建时间: {style['created_at']}")
        print()

if __name__ == "__main__":
    main()
