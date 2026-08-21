#!/usr/bin/env python3
"""
对比 v3 和优化版，分析为什么优化版CG感更强
找出如何在保留写实感的前提下增加视频影调
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def compare_versions(v3_path, optimized_path, plan_path):
    """对比两个版本，找出问题"""
    
    # 读取两张图片
    v3_path = Path(v3_path)
    optimized_path = Path(optimized_path)
    
    with open(v3_path, "rb") as f:
        v3_base64 = base64.b64encode(f.read()).decode()
    
    with open(optimized_path, "rb") as f:
        optimized_base64 = base64.b64encode(f.read()).decode()
    
    # 读取原始计划
    plan_path = Path(plan_path)
    with open(plan_path, "r", encoding="utf-8") as f:
        original_plan = json.load(f)
    
    # 构建对比提示词
    prompt = f"""
你是专业的AI图像质量评估师。请对比这两张九宫格图片：

**图片1（v3版本）**：用户认为真实感较好
**图片2（优化版）**：用户反馈CG感太强，不真实

**原始约束（来自awakening_3x3_plan.json）**：
{json.dumps(original_plan.get("realism_requirements", {}), ensure_ascii=False, indent=2)}

**任务**：
1. 分析为什么优化版反而CG感更强了？
2. v3版本保留了哪些关键的写实感元素？
3. 优化版在哪里偏离了写实感？

**重点分析**：
- 材质质感（金属、皮肤、布料、植物）
- 光影自然度（是否有生硬的CG光、不自然的反光）
- 色彩真实度（是否过度调色、滤镜感太重）
- 细节处理（是否过度锐化、颗粒不自然）
- 整体氛围（是否像游戏截图而非真实摄影）

**输出格式（JSON）**：
{{
  "v3_优点": [
    "写实处1：...",
    "写实处2：..."
  ],
  "优化版_问题": [
    "CG感问题1：...",
    "CG感问题2：..."
  ],
  "关键差异": {{
    "材质": "...",
    "光影": "...",
    "色彩": "...",
    "细节": "...",
    "氛围": "..."
  }},
  "优化建议": {{
    "保留v3的": ["...", "..."],
    "适度增加视频影调的": ["...", "..."],
    "绝对不能做的": ["...", "..."]
  }},
  "新的影调策略": "如何在保留写实感的前提下，适度增加视频的繁复光影和油画质感（不要过度）"
}}
"""
    
    # 构建多模态消息
    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{v3_base64}"}
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{optimized_base64}"}
        }
    ]
    
    print("🔍 正在对比 v3 和优化版...")
    print("   分析为什么优化版CG感更强\n")
    
    response = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": content}]
        },
        timeout=300
    )
    
    result = response.json()
    
    if "choices" in result and len(result["choices"]) > 0:
        analysis_text = result["choices"][0]["message"]["content"]
        
        # 提取JSON
        try:
            json_start = analysis_text.find("{")
            json_end = analysis_text.rfind("}") + 1
            json_str = analysis_text[json_start:json_end]
            analysis = json.loads(json_str)
        except:
            analysis = {"raw_analysis": analysis_text}
        
        # 保存结果
        output_path = Path.home() / "Desktop" / "视频复刻" / "v3_vs_optimized_analysis.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        
        print("✅ 对比分析完成！\n")
        
        # 打印关键发现
        if "v3_优点" in analysis:
            print("="*80)
            print("【v3版本的写实感优点】")
            print("="*80)
            for point in analysis["v3_优点"]:
                print(f"  ✓ {point}")
        
        if "优化版_问题" in analysis:
            print("\n" + "="*80)
            print("【优化版的CG感问题】")
            print("="*80)
            for problem in analysis["优化版_问题"]:
                print(f"  ✗ {problem}")
        
        if "关键差异" in analysis:
            print("\n" + "="*80)
            print("【关键差异对比】")
            print("="*80)
            for key, value in analysis["关键差异"].items():
                print(f"\n{key}:")
                print(f"  {value}")
        
        if "优化建议" in analysis:
            print("\n" + "="*80)
            print("【新的优化策略】")
            print("="*80)
            
            print("\n保留v3的:")
            for item in analysis["优化建议"].get("保留v3的", []):
                print(f"  ✓ {item}")
            
            print("\n适度增加视频影调的:")
            for item in analysis["优化建议"].get("适度增加视频影调的", []):
                print(f"  + {item}")
            
            print("\n绝对不能做的:")
            for item in analysis["优化建议"].get("绝对不能做的", []):
                print(f"  ✗ {item}")
        
        if "新的影调策略" in analysis:
            print("\n" + "="*80)
            print("【总结：新的影调策略】")
            print("="*80)
            print(analysis["新的影调策略"])
        
        print(f"\n📁 详细分析已保存: {output_path}")
        
        return analysis
    else:
        print(f"❌ 分析失败: {result}")
        return None


def main():
    print("\n" + "="*80)
    print("【v3 vs 优化版 - 对比分析】")
    print("找出为什么优化版CG感更强")
    print("="*80 + "\n")
    
    # Usage: python3 compare_v3_optimized.py <v3图路径> <优化版图路径> <分镜方案json路径>
    if len(sys.argv) != 4:
        print("Usage: python3 compare_v3_optimized.py <v3图路径> <优化版图路径> <分镜方案json路径>")
        sys.exit(1)
    compare_versions(sys.argv[1], sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
