#!/usr/bin/env python3
"""
深度对比《未来废土风》视频与平衡版图片
找出"为什么总差一点"的根本原因
同时标注：哪些调整会导致CG化（绝对禁止）
"""
import os
import base64
import requests
from pathlib import Path
import json

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def deep_compare_with_video():
    """深度对比视频与平衡版"""
    
    # 读取视频
    video_path = Path.home() / "Desktop" / "未来废土风.MP4"
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 读取平衡版图片
    image_path = Path.home() / "Desktop" / "视频复刻" / "苏醒片段_九宫格_平衡版.jpg"
    with open(image_path, "rb") as f:
        image_base64 = base64.b64encode(f.read()).decode()
    
    # 读取v3（作为写实基准）
    v3_path = Path.home() / "Desktop" / "视频复刻" / "苏醒片段_九宫格_v3.jpg"
    with open(v3_path, "rb") as f:
        v3_base64 = base64.b64encode(f.read()).decode()
    
    # 构建深度分析提示词
    prompt = """
你是专业的影视视觉风格分析师，擅长对比视频与静态图片的视觉差异。

**任务**：深度对比《未来废土风》视频与平衡版图片，找出"为什么总差一点"的根本原因。

**对比维度**：
1. **光影氛围的微妙差异**
   - 视频的光影是静态图无法捕捉的什么特质？
   - 动态光影与静态光影的本质区别？
   - 视频中的光影层次如何随时间变化？

2. **色彩的时间维度**
   - 视频的色彩是否有时间上的渐变、过渡？
   - 静态图缺少的"色彩呼吸感"是什么？
   - 视频中的色温变化规律？

3. **场景的空间纵深**
   - 视频的广角透视与静态图的区别？
   - 视频中的巨物感是如何通过运镜强化的？
   - 静态图缺少的"空间流动感"？

4. **材质的时间质感**
   - 视频中材质的光泽、反射如何随角度变化？
   - 静态图缺少的"材质动态感"？
   - 金属、皮肤、植物在不同光照下的微妙变化？

**关键问题**：
- 平衡版与视频的**核心差距**是什么？（不是表面参数，而是本质差异）
- 为什么调整参数后，总是"差一点"？
- 静态图片能否完全复刻视频的视觉感受？如果不能，能做到的极限是什么？

**安全边界（避免CG化）**：
基于之前的失败经验，请明确标注：
- ✅ **安全调整**：不会导致CG化的调整
- ⚠️ **谨慎调整**：可能导致轻微CG化的调整（需要控制强度）
- 🚫 **禁止调整**：必定导致CG化的调整（绝对不能做）

**输出格式（JSON）**：
{
  "核心差距": {
    "光影氛围": "视频有X，静态图缺少Y",
    "色彩时间维度": "视频有X，静态图缺少Y",
    "空间纵深": "视频有X，静态图缺少Y",
    "材质动态感": "视频有X，静态图缺少Y"
  },
  "为什么总差一点": "根本原因分析（本质差异，不是参数差异）",
  "静态图的极限": "静态图片能做到的最佳效果是什么？",
  "精准调整方案": {
    "安全调整": [
      "调整1（+X%）：描述",
      "调整2（+Y%）：描述"
    ],
    "谨慎调整": [
      "调整1（控制在Z%以内）：描述 - 风险提示",
      "调整2（控制在W%以内）：描述 - 风险提示"
    ],
    "禁止调整": [
      "调整1：为什么会导致CG化",
      "调整2：为什么会导致CG化"
    ]
  },
  "新的生成策略": "基于深度分析，如何在保留写实感的前提下，最大化接近视频的视觉感受",
  "预期效果": "调整后的预期改进和局限性"
}
"""
    
    # 构建多模态消息（视频 + 2张图片）
    content = [
        {"type": "text", "text": prompt},
        {
            "type": "video_url",
            "video_url": {"url": f"data:video/mp4;base64,{video_base64}"}
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{v3_base64}"}
        }
    ]
    
    print("🔍 正在深度对比视频与平衡版...")
    print("   分析维度：光影氛围、色彩时间、空间纵深、材质动态")
    print("   重点：找出'为什么总差一点'的根本原因\n")
    
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
        timeout=180
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
        output_path = Path.home() / "Desktop" / "视频复刻" / "deep_gap_analysis_v2.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        
        print("✅ 深度对比分析完成！\n")
        
        # 打印关键发现
        if "核心差距" in analysis:
            print("="*80)
            print("【核心差距（视频 vs 静态图）】")
            print("="*80)
            for key, value in analysis["核心差距"].items():
                print(f"\n{key}:")
                print(f"  {value}")
        
        if "为什么总差一点" in analysis:
            print("\n" + "="*80)
            print("【为什么总差一点？】")
            print("="*80)
            print(analysis["为什么总差一点"])
        
        if "静态图的极限" in analysis:
            print("\n" + "="*80)
            print("【静态图的极限】")
            print("="*80)
            print(analysis["静态图的极限"])
        
        if "精准调整方案" in analysis:
            print("\n" + "="*80)
            print("【精准调整方案（安全边界）】")
            print("="*80)
            
            safe = analysis["精准调整方案"].get("安全调整", [])
            if safe:
                print("\n✅ 安全调整（不会CG化）:")
                for item in safe:
                    print(f"  ✓ {item}")
            
            cautious = analysis["精准调整方案"].get("谨慎调整", [])
            if cautious:
                print("\n⚠️  谨慎调整（控制强度）:")
                for item in cautious:
                    print(f"  ⚠️  {item}")
            
            forbidden = analysis["精准调整方案"].get("禁止调整", [])
            if forbidden:
                print("\n🚫 禁止调整（必定CG化）:")
                for item in forbidden:
                    print(f"  ✗ {item}")
        
        if "新的生成策略" in analysis:
            print("\n" + "="*80)
            print("【新的生成策略】")
            print("="*80)
            print(analysis["新的生成策略"])
        
        if "预期效果" in analysis:
            print("\n" + "="*80)
            print("【预期效果与局限性】")
            print("="*80)
            print(analysis["预期效果"])
        
        print(f"\n📁 详细分析已保存: {output_path}")
        
        return analysis
    else:
        print(f"❌ 分析失败: {result}")
        return None


def main():
    print("\n" + "="*80)
    print("【深度对比：《未来废土风》视频 vs 平衡版】")
    print("找出'为什么总差一点'的根本原因")
    print("标注安全边界（避免CG化）")
    print("="*80 + "\n")
    
    deep_compare_with_video()


if __name__ == "__main__":
    main()
