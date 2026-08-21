#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
汽车模型生成完整工作流
"""

import osfrom pathlib import Path
from typing import Dict, List, Optional
import json
import shutil
from datetime import datetime

from ..core.gemini_client import GeminiClient
from ..core.doubao_analyzer import DoubaoAnalyzer


class CarModelGenerator:
    """汽车模型生成器 - 完整工作流"""

    def __init__(
        self,
        brand: str,
        model: str,
        reference_dir: Path,
        api_key: str,
        doubao_api_key: Optional[str] = None,
        base_url: str = None
    ):
        """
        初始化生成器

        Args:
            brand: 汽车品牌
            model: 车型名称
            reference_dir: 参考图目录
            api_key: Gemini API密钥
            doubao_api_key: 豆包API密钥（可选，用于质量分析）
            base_url: API基础URL
        """
        self.brand = brand
        self.model = model
        self.reference_dir = Path(reference_dir)

        # 初始化客户端
        _base = base_url or os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn")
        self.gemini = GeminiClient(api_key=api_key, base_url=_base)

        if doubao_api_key:
            self.doubao = DoubaoAnalyzer(api_key=doubao_api_key, base_url=f"{_base}/v1")
        else:
            self.doubao = None

        # 加载提示词配置
        self.prompts = self._load_prompts()

        # 输出目录
        self.output_dir = Path(f"output_{brand.lower()}_{model.lower()}")
        self.output_dir.mkdir(exist_ok=True)

        # 生成的图片目录
        self.images_dir = self.output_dir / "generated"
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # 分析结果目录
        self.analysis_dir = self.output_dir / "analysis"
        self.analysis_dir.mkdir(parents=True, exist_ok=True)

    def _load_prompts(self) -> Dict:
        """加载提示词配置"""
        prompts = {}

        # 加载车身视图提示词
        body_views_path = Path("config/prompts/body_views.json")
        if body_views_path.exists():
            with open(body_views_path, 'r', encoding='utf-8') as f:
                body_prompts = json.load(f)
                # 替换占位符
                for key, prompt in body_prompts.items():
                    prompts[key] = prompt.format(brand=self.brand, model=self.model)

        # 加载细节图提示词
        details_path = Path("config/prompts/details.json")
        if details_path.exists():
            with open(details_path, 'r', encoding='utf-8') as f:
                detail_prompts = json.load(f)
                # 替换占位符
                for key, prompt in detail_prompts.items():
                    prompts[key] = prompt.format(brand=self.brand, model=self.model)

        return prompts

    def _select_reference_images(self, category: str) -> List[Path]:
        """
        为特定类别选择参考图

        Args:
            category: 图片类别

        Returns:
            参考图路径列表
        """
        # 获取所有参考图（包括.jpg, .jpeg, .png）
        all_refs = sorted(self.reference_dir.glob("*.jpg")) + \
                   sorted(self.reference_dir.glob("*.jpeg")) + \
                   sorted(self.reference_dir.glob("*.png"))

        # 简单策略：使用前6张（可以根据category优化）
        # TODO: 更智能的参考图选择
        return all_refs[:6]

    def generate_all(self, check_quality: bool = True) -> Dict:
        """
        生成所有图片

        Args:
            check_quality: 是否使用豆包检查质量

        Returns:
            生成结果
        """
        print(f"\n{'='*60}")
        print(f"开始生成 {self.brand} {self.model}")
        print(f"{'='*60}\n")

        categories = [
            ('body_front', '16:9'),
            ('body_side', '16:9'),
            ('body_rear', '16:9'),
            ('wheel', '1:1'),
            ('logo', '1:1'),
            ('sensor_radar', '1:1'),
            ('lights_front', '1:1'),
            ('lights_rear', '1:1')
        ]

        results = {}
        failed = []

        for category, aspect_ratio in categories:
            print(f"\n生成 {category}...")

            try:
                # 选择参考图
                ref_images = self._select_reference_images(category)

                # 获取提示词
                prompt = self.prompts.get(category, f"Generate {category} for {self.brand} {self.model}")

                # 生成图片
                output_path = self.gemini.generate_category_image(
                    category=category,
                    reference_images=ref_images,
                    prompt=prompt,
                    output_dir=self.images_dir,
                    aspect_ratio=aspect_ratio,
                    image_size="2K"
                )

                # 质量检查
                if check_quality and self.doubao and ref_images:
                    print(f"  检查质量...")
                    quality = self.doubao.check_quality(
                        reference_image=ref_images[0],
                        generated_image=output_path,
                        category=category
                    )

                    if not quality['pass']:
                        print(f"  [WARNING] 质量检查未通过")
                        print(f"  问题: {', '.join(quality['issues'])}")
                        failed.append((category, quality))
                    else:
                        print(f"  [OK] 质量检查通过")

                results[category] = {
                    'status': 'success',
                    'path': str(output_path)
                }

            except Exception as e:
                print(f"  [ERROR] 生成失败: {e}")
                results[category] = {
                    'status': 'failed',
                    'error': str(e)
                }
                failed.append((category, {'issues': [str(e)]}))

        # 生成总结
        print(f"\n{'='*60}")
        print(f"生成完成")
        print(f"{'='*60}")
        print(f"成功: {len([r for r in results.values() if r['status'] == 'success'])}/{len(categories)}")

        if failed:
            print(f"失败: {len(failed)}/{len(categories)}")
            for category, info in failed:
                print(f"  - {category}: {', '.join(info.get('issues', ['Unknown']))}")

        return {
            'status': 'success' if not failed else 'partial',
            'results': results,
            'failed': failed,
            'output_dir': str(self.output_dir)
        }

    def regenerate_with_doubao_analysis(
        self,
        category: str,
        reference_image: Path
    ) -> Dict:
        """
        使用豆包分析后重新生成

        Args:
            category: 需要重新生成的类别
            reference_image: 参考图

        Returns:
            重新生成结果
        """
        if not self.doubao:
            raise ValueError("豆包分析器未初始化，无法进行智能优化")

        print(f"\n{'='*60}")
        print(f"使用豆包分析优化 {category}")
        print(f"{'='*60}\n")

        # 当前生成的图片
        generated_image = self.images_dir / f"{category}.jpg"

        if not generated_image.exists():
            raise FileNotFoundError(f"生成图不存在: {generated_image}")

        # 豆包分析
        print("  豆包分析中...")
        analysis = self.doubao.analyze_generation(
            reference_image=reference_image,
            generated_image=generated_image,
            current_prompt=self.prompts.get(category, ""),
            category=category
        )

        # 保存分析结果
        analysis_file = self.analysis_dir / f"{category}_analysis.json"
        with open(analysis_file, 'w', encoding='utf-8') as f:
            json.dump(analysis, f, ensure_ascii=False, indent=2)

        print(f"  问题:")
        for issue in analysis.get('issues', []):
            print(f"    - {issue}")

        print(f"\n  根本原因:")
        print(f"    {analysis.get('root_cause', 'N/A')}")

        # 使用优化后的提示词重新生成
        print(f"\n  使用优化提示词重新生成...")
        optimized_prompt = analysis.get('optimized_prompt', self.prompts.get(category, ""))

        # 选择参考图
        ref_images = self._select_reference_images(category)

        # 确定宽高比
        aspect_ratio = "16:9" if category.startswith('body_') else "1:1"

        # 重新生成
        output_path = self.gemini.generate_category_image(
            category=category,
            reference_images=ref_images,
            prompt=optimized_prompt,
            output_dir=self.images_dir,
            aspect_ratio=aspect_ratio,
            image_size="2K"
        )

        print(f"  [OK] 重新生成完成")

        return {
            'status': 'success',
            'path': str(output_path),
            'analysis': analysis,
            'optimized_prompt': optimized_prompt
        }

    def save_to_database(self, db_dir: Path = Path("car_database")) -> Dict:
        """
        保存到数据库

        Args:
            db_dir: 数据库根目录

        Returns:
            保存结果
        """
        print(f"\n{'='*60}")
        print(f"保存到数据库")
        print(f"{'='*60}\n")

        # 目标目录
        target_dir = db_dir / self.brand / self.model
        target_dir.mkdir(parents=True, exist_ok=True)

        # 图片目录
        images_db_dir = target_dir / "images"
        images_db_dir.mkdir(exist_ok=True)

        # 复制图片
        print("  复制图片...")
        for img_file in self.images_dir.glob("*.jpg"):
            dst = images_db_dir / img_file.name
            shutil.copy2(img_file, dst)
            print(f"    [OK] {img_file.name}")

        # 创建元数据
        print("\n  创建元数据...")
        metadata = {
            "brand": self.brand,
            "model": self.model,
            "full_name": f"{self.brand} {self.model}",
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "images": {
                "body_views": ["body_front.jpg", "body_side.jpg", "body_rear.jpg"],
                "details": ["wheel.jpg", "logo.jpg", "sensor_radar.jpg", "lights_front.jpg", "lights_rear.jpg"]
            },
            "status": "completed",
            "quality_verified": True
        }

        metadata_path = target_dir / "metadata.json"
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        print(f"  [OK] 元数据已保存")

        print(f"\n{'='*60}")
        print(f"保存完成: {target_dir}")
        print(f"{'='*60}")

        return {
            'status': 'success',
            'database_path': str(target_dir)
        }
