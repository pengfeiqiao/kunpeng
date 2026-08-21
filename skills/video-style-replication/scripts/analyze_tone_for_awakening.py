#!/usr/bin/env python3
"""
分析《未来废土风》视频的影调特征，优化苏醒片段的视觉风格
重点：繁复光影、巨物感、老旧油画感
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.dmxapi_client import DMXAPIClient

def analyze_video_tone(video_path, current_plan_path):
    """分析视频影调，生成优化建议"""
    
    client = DMXAPIClient()
    
    # 读取当前计划
    with open(current_plan_path, "r", encoding="utf-8") as f:
        current_plan = json.load(f)
    
    # 读取视频文件
    print(f"📹 正在分析视频: {video_path}")
    video_size = Path(video_path).stat().st_size / (1024 * 1024)
    print(f"   视频大小: {video_size:.1f} MB")
    
    with open(video_path, "rb") as f:
        video_base64 = base64.b64encode(f.read()).decode()
    
    # 构建分析提示词
    analysis_prompt = f"""
你是一个专业的影视视觉分析师。请分析这段《未来废土风》视频的影调特征，重点关注以下三个方面：

1. **繁复光影**：
   - 光影层次（几层光影？主光、辅光、环境光的关系）
   - 光影质感（硬光/软光？反差多大？）
   - 光影动态（是否有光斑、光晕、体积光等复杂光影效果）
   - 色温变化（冷暖光的对比和过渡）

2. **巨物感**：
   - 场景构图（如何营造空间纵深感？）
   - 透视关系（广角/长焦？透视变形程度？）
   - 物体比例（人物与环境的大小对比）
   - 视觉重心（如何引导视线感受宏大场景？）

3. **老旧油画感**：
   - 色彩特征（饱和度、明度、色相分布）
   - 质感表现（颗粒感、噪点、笔触感）
   - 边缘处理（锐度、柔化、晕影）
   - 色调倾向（偏暖/偏冷？有无色偏？）

请对比我现有的生成计划（见附件），指出：
- 当前计划的影调与视频的差距
- 需要调整的具体参数（色温、对比度、饱和度等）
- 需要增加的视觉元素（光影效果、场景元素等）

输出格式（JSON）：
{{
  "video_tone_analysis": {{
    "繁复光影": {{
      "光影层次": "...",
      "光影质感": "...",
      "光影动态": "...",
      "色温变化": "..."
    }},
    "巨物感": {{
      "场景构图": "...",
      "透视关系": "...",
      "物体比例": "...",
      "视觉重心": "..."
    }},
    "老旧油画感": {{
      "色彩特征": "...",
      "质感表现": "...",
      "边缘处理": "...",
      "色调倾向": "..."
    }}
  }},
  "gap_analysis": {{
    "当前差距": ["...", "..."],
    "关键问题": "..."
  }},
  "optimization_suggestions": {{
    "影调参数调整": {{
      "色温": "具体数值",
      "对比度": "具体描述",
      "饱和度": "具体描述",
      "暗角": "具体数值",
      "颗粒": "具体数值"
    }},
    "新增视觉元素": [
      "...",
      "..."
    ],
    "场景调整建议": [
      "...",
      "..."
    ]
  }}
}}
"""
    
    # 构建多模态消息
    content = [
        {"type": "text", "text": analysis_prompt},
        {
            "type": "video_url",
            "video_url": {
                "url": f"data:video/mp4;base64,{video_base64}"
            }
        }
    ]
    
    print("\n🔍 正在使用豆包多模态分析视频影调...")
    print("   分析维度：繁复光影 + 巨物感 + 老旧油画感")
    
    response = requests.post(
        f"{client.base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {client.api_key}",
            "Content-Type": "application/json"
        },
        json={
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": content}]
        },
        timeout=180  # 视频分析需要更长时间
    )
    
    result = response.json()
    
    if "choices" in result and len(result["choices"]) > 0:
        analysis_text = result["choices"][0]["message"]["content"]
        
        # 尝试提取JSON
        try:
            # 找到JSON部分
            json_start = analysis_text.find("{")
            json_end = analysis_text.rfind("}") + 1
            json_str = analysis_text[json_start:json_end]
            analysis = json.loads(json_str)
        except:
            print("⚠️  无法解析JSON，保存原始分析结果")
            analysis = {"raw_analysis": analysis_text}
        
        # 保存分析结果
        output_path = Path.home() / "Desktop" / "视频复刻" / "tone_analysis_result.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ 分析完成！结果已保存: {output_path}")
        
        # 打印关键发现
        if "video_tone_analysis" in analysis:
            print("\n" + "="*80)
            print("【视频影调特征】")
            print("="*80)
            
            for dimension, details in analysis["video_tone_analysis"].items():
                print(f"\n{dimension}:")
                for key, value in details.items():
                    print(f"  • {key}: {value}")
        
        if "gap_analysis" in analysis:
            print("\n" + "="*80)
            print("【差距分析】")
            print("="*80)
            for gap in analysis["gap_analysis"].get("当前差距", []):
                print(f"  • {gap}")
        
        if "optimization_suggestions" in analysis:
            print("\n" + "="*80)
            print("【优化建议】")
            print("="*80)
            
            params = analysis["optimization_suggestions"].get("影调参数调整", {})
            if params:
                print("\n影调参数:")
                for key, value in params.items():
                    print(f"  • {key}: {value}")
            
            elements = analysis["optimization_suggestions"].get("新增视觉元素", [])
            if elements:
                print("\n新增视觉元素:")
                for elem in elements:
                    print(f"  • {elem}")
        
        return analysis
    else:
        print(f"❌ 分析失败: {result}")
        return None


def main():
    print("\n" + "="*80)
    print("【未来废土风 - 影调分析与优化】")
    print("重点：繁复光影 + 巨物感 + 老旧油画感")
    print("="*80 + "\n")
    
    video_path = Path.home() / "Desktop" / "未来废土风.MP4"
    plan_path = Path.home() / "Desktop" / "视频复刻" / "awakening_3x3_plan.json"
    
    if not video_path.exists():
        print(f"❌ 视频文件不存在: {video_path}")
        return
    
    if not plan_path.exists():
        print(f"❌ 计划文件不存在: {plan_path}")
        return
    
    result = analyze_video_tone(video_path, plan_path)
    
    if result:
        print("\n" + "="*80)
        print("【下一步】")
        print("="*80)
        print("1. 查看分析结果: ~/Desktop/视频复刻/tone_analysis_result.json")
        print("2. 根据优化建议调整 awakening_3x3_plan.json")
        print("3. 重新运行生成脚本")


if __name__ == "__main__":
    main()
