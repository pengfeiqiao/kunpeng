#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
豆包多模态对比分析系统
功能：对比生成图片与参考图的细节差异，自动分析问题
"""

import osfrom pathlib import Path
from typing import List, Dict, Tuple
import json
from openai import OpenAI


class DoubaoComparisonAnalyzer:
    """豆包多模态对比分析器"""

    def __init__(self, api_key: str):
        """
        初始化分析器

        Args:
            api_key: API密钥
        """
        self.client = OpenAI(
            api_key=api_key,
            base_url=os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
        )
        self.model = "doubao-seed-2-0-pro-260215"

    def compare_images(
        self,
        reference_images: List[Path],
        generated_image: Path,
        category: str
    ) -> Dict:
        """
        对比参考图和生成图，分析差异

        Args:
            reference_images: 参考图列表
            generated_image: 生成的图片
            category: 类别（wheel, sensor_radar, lights, logo）

        Returns:
            分析结果字典
        """
        category_names = {
            'wheel': '轮毂',
            'logo': '车标',
            'sensor_radar': '传感器雷达',
            'lights': '灯组'
        }

        category_cn = category_names.get(category, category)

        print(f"\n{'='*60}")
        print(f"开始对比分析：{category_cn}")
        print(f"{'='*60}")
        print(f"参考图: {len(reference_images)}张")
        print(f"生成图: {generated_image.name}")

        # 构建详细的对比prompt
        comparison_prompts = {
            'wheel': """请详细对比这些图片：
- 前面几张是真实的蔚来ES8轮毂参考图（真实产品）
- 最后一张是AI生成的轮毂图

请逐项对比以下细节，找出所有差异：

1. **轮毂中心区域**：
   - 中心轮毂盖：颜色（银色/黑色）、NIO标志（凸起/凹陷、颜色）
   - 固定螺栓：数量（5颗/6颗）、颜色（黑色/银色）、形状（凸起/凹陷）

2. **辐条设计**：
   - 辐条数量：数一下有多少根辐条
   - 辐条形状：宽度、样式（刀锋式/直条式）
   - 辐条颜色：双色/单色、具体配色
   - 辐条排列：平行双辐/单辐、间距

3. **刹车系统**：
   - 刹车卡钳颜色：红色/橙红色
   - NIO文字：方向（正向/倒置）、可见性
   - 刹车盘暴露程度：大面积可见/几乎遮挡

4. **轮胎细节**：
   - 轮胎标识是否可见
   - 轮毂与轮胎连接

请用以下格式回答：

【对比结果】
项目 | 参考图（真实） | 生成图 | 是否一致
--- | --- | --- | ---
中心轮毂盖 | [描述] | [描述] | ✅/❌
固定螺栓 | [数量+颜色] | [数量+颜色] | ✅/❌
辐条数量 | [数量] | [数量] | ✅/❌
辐条样式 | [描述] | [描述] | ✅/❌
刹车卡钳 | [颜色+文字] | [颜色+文字] | ✅/❌

【严重问题】（标❌的项目）
1. [问题描述]
2. [问题描述]
...

【问题根源分析】
[分析为什么会出现这些差异，是prompt问题还是参考图权重问题]

【改进建议】
[具体建议如何修正]""",

            'sensor_radar': """请详细对比这些图片：
- 前面几张是真实的蔚来ES8 AQUILA传感器参考图（真实产品）
- 最后一张是AI生成的传感器图

请逐项对比以下细节，找出所有差异：

1. **前翼子板传感器模块**：
   - 位置：相对于轮拱的高度
   - 装饰条方向：横向/竖向
   - 装饰条数量：数一下有多少条
   - 激光雷达罩：有无、大小、透明度

2. **摄像头和标识**：
   - 摄像头位置：左侧/右侧/中间
   - AQUILA文字位置：左上/右上/中间
   - 摄像头右侧短装饰条数量

3. **整体造型**：
   - 模块形状：上宽下窄/矩形
   - 边框材质和颜色

请用以下格式回答：

【对比结果】
项目 | 参考图（真实） | 生成图 | 是否一致
--- | --- | --- | ---
装饰条方向 | [横向/竖向] | [横向/竖向] | ✅/❌
装饰条数量 | [数量] | [数量] | ✅/❌
激光雷达罩 | [有/无] | [有/无] | ✅/❌
AQUILA位置 | [位置] | [位置] | ✅/❌
摄像头位置 | [位置] | [位置] | ✅/❌

【严重问题】（标❌的项目）
1. [问题描述]
2. [问题描述]
...

【问题根源分析】
[分析为什么会出现这些差异]

【改进建议】
[具体建议如何修正]""",

            'lights': """请详细对比这些图片：
- 前面几张是真实的蔚来ES8灯组参考图（真实产品）
- 最后一张是AI生成的灯组图

请逐项对比以下细节，找出所有差异：

1. **前大灯**：
   - 日行灯层数：数一下有几层灯带（2层/3层）
   - 透镜数量和形状：圆形/圆角矩形
   - 透镜外框：银色装饰圈的形状
   - 透镜间距：很近/较远

2. **尾灯**：
   - 贯穿式灯带层数：几层
   - 侧边尾灯形状：横向矩形/竖向矩形
   - 侧边尾灯层数：与中间段是否一致
   - ES8标识：位置和清晰度

请用以下格式回答：

【对比结果】
项目 | 参考图（真实） | 生成图 | 是否一致
--- | --- | --- | ---
前日行灯层数 | [层数] | [层数] | ✅/❌
前透镜形状 | [形状] | [形状] | ✅/❌
尾灯侧单元形状 | [横向/竖向] | [横向/竖向] | ✅/❌
尾灯层数统一 | [是/否] | [是/否] | ✅/❌

【严重问题】（标❌的项目）
1. [问题描述]
2. [问题描述]
...

【问题根源分析】
[分析为什么会出现这些差异]

【改进建议】
[具体建议如何修正]""",

            'logo': """请详细对比这些图片：
- 前面几张是真实的NIO车标参考图（真实产品）
- 最后一张是AI生成的车标图

请逐项对比以下细节，找出所有差异：

1. **标志设计**：
   - 是否100% NIO标志（天空+道路设计）
   - 有无混入其他品牌元素

2. **材质和质感**：
   - 镀铬质感
   - 反光效果
   - 立体感

3. **整体呈现**：
   - 清晰度
   - 品牌识别度

请用以下格式回答：

【对比结果】
项目 | 参考图（真实） | 生成图 | 是否一致
--- | --- | --- | ---
品牌标识 | [NIO] | [NIO/其他] | ✅/❌
镀铬质感 | [描述] | [描述] | ✅/❌
立体结构 | [描述] | [描述] | ✅/❌

【严重问题】（标❌的项目）
1. [问题描述]
2. [问题描述]
...

【问题根源分析】
[分析为什么会出现这些差异]

【改进建议】
[具体建议如何修正]"""
        }

        prompt = comparison_prompts.get(category, "请对比这些图片的差异")

        # 构建消息（参考图 + 生成图）
        messages = [
            {
                "role": "user",
                "content": []
            }
        ]

        # 添加参考图
        for ref_img in reference_images:
            messages[0]["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": f"file://{ref_img.absolute()}"
                }
            })

        # 添加生成图
        messages[0]["content"].append({
            "type": "image_url",
            "image_url": {
                "url": f"file://{generated_image.absolute()}"
            }
        })

        # 添加prompt
        messages[0]["content"].append({
            "type": "text",
            "text": prompt
        })

        print(f"\n调用豆包多模态分析API...")
        print(f"分析图片: {len(reference_images)}张参考图 + 1张生成图")

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.1,  # 降低温度确保客观分析
                max_tokens=4000
            )

            analysis = response.choices[0].message.content

            print(f"\n{'='*60}")
            print(f"[OK] 对比分析完成")
            print(f"{'='*60}")

            return {
                'category': category,
                'category_cn': category_cn,
                'reference_count': len(reference_images),
                'generated_image': str(generated_image),
                'analysis': analysis,
                'model': self.model
            }

        except Exception as e:
            print(f"[ERROR] 分析失败: {e}")
            raise

    def batch_compare(
        self,
        classification_result_path: Path,
        generated_dir: Path,
        output_path: Path = None
    ) -> Dict:
        """
        批量对比所有类别

        Args:
            classification_result_path: 分类结果JSON路径
            generated_dir: 生成图片目录
            output_path: 对比报告输出路径

        Returns:
            完整对比报告
        """
        print(f"\n{'#'*60}")
        print(f"批量对比分析开始")
        print(f"{'#'*60}")

        # 读取分类结果
        with open(classification_result_path, 'r', encoding='utf-8') as f:
            classification = json.load(f)

        # 对比结果
        results = {}

        # 需要对比的类别
        categories = ['wheel', 'sensor_radar', 'lights', 'logo']

        for category in categories:
            # 获取参考图
            ref_images_str = classification.get(category, [])
            if category == 'sensor_radar':
                ref_images_str = classification.get('sensor', [])

            reference_images = [Path(img) for img in ref_images_str]

            # 获取生成图
            if category == 'sensor_radar':
                generated_image = generated_dir / 'sensor_radar.jpg'
            else:
                generated_image = generated_dir / f'{category}.jpg'

            if not generated_image.exists():
                print(f"⚠️ 跳过{category}: 生成图不存在")
                continue

            if not reference_images:
                print(f"⚠️ 跳过{category}: 无参考图")
                continue

            # 执行对比
            result = self.compare_images(
                reference_images=reference_images,
                generated_image=generated_image,
                category=category
            )

            results[category] = result

        # 生成完整报告
        report = {
            'timestamp': Path(output_path).stem if output_path else 'comparison',
            'model': self.model,
            'total_categories': len(results),
            'results': results
        }

        # 保存报告
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            print(f"\n✓ 对比报告已保存: {output_path}")

        # 生成Markdown报告
        if output_path:
            md_path = output_path.with_suffix('.md')
            self._generate_markdown_report(report, md_path)
            print(f"✓ Markdown报告已保存: {md_path}")

        return report

    def _generate_markdown_report(self, report: Dict, output_path: Path):
        """生成Markdown格式的报告"""

        lines = [
            "# 🔍 豆包多模态对比分析报告",
            "",
            f"**生成时间**: {report['timestamp']}",
            f"**分析模型**: {report['model']}",
            f"**对比类别数**: {report['total_categories']}",
            "",
            "---",
            ""
        ]

        for category, result in report['results'].items():
            lines.extend([
                f"## {result['category_cn']} ({category})",
                "",
                f"**参考图数量**: {result['reference_count']}张",
                f"**生成图**: `{Path(result['generated_image']).name}`",
                "",
                "### 对比分析",
                "",
                result['analysis'],
                "",
                "---",
                ""
            ])

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))


if __name__ == "__main__":
    # 测试代码
    import sys

    if len(sys.argv) < 2:
        print("用法: python doubao_comparison_analyzer.py <API_KEY>")
        sys.exit(1)

    api_key = sys.argv[1]

    # 创建分析器
    analyzer = DoubaoComparisonAnalyzer(api_key)

    # 批量对比
    classification_path = Path("output_full_test/classification_result.json")
    generated_dir = Path("output_optimized/generated")
    output_path = Path("comparison_analysis.json")

    if not classification_path.exists():
        print(f"错误: 分类结果文件不存在: {classification_path}")
        sys.exit(1)

    if not generated_dir.exists():
        print(f"错误: 生成图目录不存在: {generated_dir}")
        sys.exit(1)

    report = analyzer.batch_compare(
        classification_result_path=classification_path,
        generated_dir=generated_dir,
        output_path=output_path
    )

    print(f"\n✓ 批量对比完成！")
    print(f"  JSON报告: {output_path}")
    print(f"  Markdown报告: {output_path.with_suffix('.md')}")
