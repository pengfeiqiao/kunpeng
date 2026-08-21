#!/usr/bin/env python3
"""
让豆包基于最佳图片创作雨崩未来末世风剧情和分镜方案
"""
import os
import base64
import requests
from pathlib import Path
import json
import sys

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def create_storyline_and_storyboard(image_path):
    """创作剧情和分镜方案"""

    # 读取最佳图片
    image_path = Path(image_path)
    with open(image_path, "rb") as f:
        image_base64 = base64.b64encode(f.read()).decode()

    prompt = """
你是专业的科幻编剧和分镜设计师。请基于这张图片的视觉风格，创作一段完整的雨崩未来末世风剧情，并设计详细的分镜方案。

【图片分析】
请先分析这张图片的：
1. 视觉风格特征
2. 氛围和情绪
3. 核心视觉元素
4. 世界观设定

【剧情创作要求】
基于图片中的元素（生物化转经筒、能量光束、雨崩环境），创作一段：
- 主题：雨崩 + 未来末世 + 探索发现
- 时长：3-5分钟的短片剧情
- 风格：奇幻史诗感 + 失落文明 + 神秘探索
- 核心冲突：人与巨物、过去与未来、科技与信仰
- 情感弧线：震撼 → 困惑 → 探索 → 发现 → 觉醒

【剧情要素】
1. **世界观设定**：
   - 时间：未来某个时间点
   - 地点：雨崩（梅里雪山脚下）
   - 巨物：生物化转经筒矩阵的起源和意义
   - 文明：失落文明的遗迹

2. **人物设定**：
   - 主角：女性探索者（图片中的人物）
   - 背景：为什么来到雨崩？
   - 目标：寻找什么？
   - 内心冲突：信仰与科技的矛盾

3. **核心事件**：
   - 开场：发现巨物
   - 发展：探索过程
   - 高潮：真相揭示
   - 结局：觉醒或选择

【分镜设计要求】
基于剧情，设计**9-12个关键分镜**（适合九宫格或十二宫格）：

每个分镜包含：
1. **景别**：特写/近景/中景/全景/远景
2. **角度**：平拍/仰拍/俯拍/侧拍
3. **内容**：具体画面描述
4. **光影**：光线设计
5. **氛围**：情绪和氛围
6. **叙事**：推进剧情的作用
7. **视觉重点**：观众应该关注什么

【分镜设计原则】
- 前3个分镜：建立世界观和氛围（震撼感）
- 中3-6个分镜：探索和发现（神秘感）
- 后3-6个分镜：高潮和觉醒（史诗感）
- 每个分镜都要有视觉冲击力
- 符合21:9画幅的横向延展感
- 保持中远景35%油画感，近景写实

【输出格式（JSON）】
{
  "图片分析": {
    "视觉风格": "描述",
    "氛围情绪": "描述",
    "核心元素": ["元素1", "元素2"],
    "世界观": "描述"
  },
  
  "剧情大纲": {
    "片名": "标题",
    "时长": "3-5分钟",
    "一句话简介": "...",
    "世界观设定": {
      "时间": "...",
      "地点": "...",
      "巨物起源": "...",
      "文明背景": "..."
    },
    "人物设定": {
      "主角": "...",
      "背景": "...",
      "目标": "...",
      "内心冲突": "..."
    },
    "剧情结构": {
      "开场": "...",
      "发展": "...",
      "高潮": "...",
      "结局": "..."
    }
  },
  
  "分镜方案": [
    {
      "序号": 1,
      "标题": "分镜标题",
      "景别": "全景",
      "角度": "仰拍",
      "画幅": "21:9",
      "内容": "详细描述",
      "光影": "描述",
      "氛围": "描述",
      "叙事作用": "描述",
      "视觉重点": "描述",
      "油画感": "近景/中远景，百分比"
    }
  ],
  
  "视觉风格统一要求": {
    "画幅": "21:9",
    "油画感": "仅中远景35%",
    "光影": "柔和散射光",
    "色彩": "钴蓝天空+低饱和",
    "质感": "哑光油画磨砂"
  }
}
"""

    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}
        }
    ]

    print("🎬 正在让豆包创作剧情和分镜方案...")
    print("   基于图片的视觉风格和雨崩未来末世设定\n")

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
        output_path = Path.home() / "Desktop" / "视频复刻" / "雨崩未来末世_剧情分镜方案.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)

        print("✅ 剧情和分镜方案创作完成！\n")

        # 打印关键内容
        if "图片分析" in analysis:
            print("="*80)
            print("【图片分析】")
            print("="*80)
            for key, value in analysis["图片分析"].items():
                if isinstance(value, list):
                    print(f"{key}: {', '.join(value)}")
                else:
                    print(f"{key}: {value}")

        if "剧情大纲" in analysis:
            print("\n" + "="*80)
            print("【剧情大纲】")
            print("="*80)
            
            if "片名" in analysis["剧情大纲"]:
                print(f"\n片名：{analysis['剧情大纲']['片名']}")
            if "一句话简介" in analysis["剧情大纲"]:
                print(f"简介：{analysis['剧情大纲']['一句话简介']}")
            
            if "世界观设定" in analysis["剧情大纲"]:
                print("\n世界观设定：")
                for key, value in analysis["剧情大纲"]["世界观设定"].items():
                    print(f"  {key}: {value}")
            
            if "人物设定" in analysis["剧情大纲"]:
                print("\n人物设定：")
                for key, value in analysis["剧情大纲"]["人物设定"].items():
                    print(f"  {key}: {value}")
            
            if "剧情结构" in analysis["剧情大纲"]:
                print("\n剧情结构：")
                for key, value in analysis["剧情大纲"]["剧情结构"].items():
                    print(f"  {key}: {value}")

        if "分镜方案" in analysis:
            print("\n" + "="*80)
            print("【分镜方案】")
            print("="*80)
            for shot in analysis["分镜方案"]:
                print(f"\n分镜 {shot.get('序号', '?')}: {shot.get('标题', '')}")
                print(f"  景别: {shot.get('景别', '')} | 角度: {shot.get('角度', '')}")
                print(f"  内容: {shot.get('内容', '')}")
                print(f"  氛围: {shot.get('氛围', '')}")
                print(f"  叙事: {shot.get('叙事作用', '')}")

        print(f"\n📁 详细方案已保存: {output_path}")

        return analysis
    else:
        print(f"❌ 创作失败: {result}")
        return None


def main():
    print("\n" + "="*80)
    print("【雨崩未来末世风剧情与分镜方案创作】")
    print("="*80 + "\n")

    # Usage: python3 create_storyline_and_storyboard.py <参考图片路径>
    if len(sys.argv) != 2:
        print("Usage: python3 create_storyline_and_storyboard.py <参考图片路径>")
        sys.exit(1)
    create_storyline_and_storyboard(sys.argv[1])


if __name__ == "__main__":
    main()
