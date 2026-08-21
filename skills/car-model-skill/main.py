#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
汽车模型一致性控制 - 主程序
实现AI汽车影像一致性控制的完整流程
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Dict, List, Tuple

from image_classifier import CarImageClassifier
from parameter_extractor import CarParameterExtractor
from api_client import BananaProClient
from doubao_vision_client import DoubaoVisionClient
from gemini_multiref_client import GeminiMultiRefClient
from utils import setup_logger, ensure_dir


class CarModelConsistencyController:
    """汽车模型一致性控制器"""

    def __init__(self, input_dir: str, output_dir: str, api_key: str, use_doubao: bool = True):
        """
        初始化控制器

        Args:
            input_dir: 输入图片目录
            output_dir: 输出目录
            api_key: API密钥（用于生图和可选的分类）
            use_doubao: 是否使用豆包进行分类和参数提取（更便宜）
        """
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.api_key = api_key
        self.use_doubao = use_doubao

        # 初始化各个模块
        if use_doubao:
            self.logger = setup_logger('CarModelController')
            self.logger.info("使用豆包多模态进行图像分类和参数提取（经济模式）")
            self.doubao_client = DoubaoVisionClient(api_key)
        else:
            self.classifier = CarImageClassifier()
            self.extractor = CarParameterExtractor()

        # 使用Gemini多图融合客户端进行生图（支持真正的参考图融合）
        self.api_client = GeminiMultiRefClient(api_key, base_url=os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn"))

        # 设置日志
        self.logger = setup_logger('CarModelController')

        # 确保输出目录存在
        ensure_dir(self.output_dir)
        ensure_dir(self.output_dir / "classified")
        ensure_dir(self.output_dir / "generated")

    def classify_images(self) -> Dict[str, List[Path]]:
        """
        步骤1: 对输入图片进行分类

        Returns:
            分类结果字典，键为类别名称，值为图片路径列表
        """
        self.logger.info(f"开始分类图片，输入目录: {self.input_dir}")

        # 获取所有图片文件
        image_files = list(self.input_dir.glob("*.jpg")) + \
                     list(self.input_dir.glob("*.jpeg")) + \
                     list(self.input_dir.glob("*.png"))

        # 过滤掉副本文件（._开头的文件）
        image_files = [f for f in image_files if not f.name.startswith('._')]

        self.logger.info(f"找到 {len(image_files)} 张图片")

        # 使用分类器进行分类
        if self.use_doubao:
            classified = self._classify_with_doubao(image_files)
        else:
            classified = self.classifier.classify_batch(image_files)

        # 保存分类结果
        classification_result = {
            category: [str(p) for p in paths]
            for category, paths in classified.items()
        }

        result_path = self.output_dir / "classification_result.json"
        with open(result_path, 'w', encoding='utf-8') as f:
            json.dump(classification_result, f, indent=2, ensure_ascii=False)

        self.logger.info(f"分类完成，结果保存到: {result_path}")
        self.logger.info(f"分类统计: {dict((k, len(v)) for k, v in classified.items())}")

        return classified

    def _classify_with_doubao(self, image_files: List[Path]) -> Dict[str, List[Path]]:
        """使用豆包进行图像分类"""
        categories = ['body', 'wheel', 'lights', 'sensor', 'logo']
        classified = {category: [] for category in categories}

        for i, image_path in enumerate(image_files, 1):
            print(f"分类进度: {i}/{len(image_files)} - {image_path.name}")
            try:
                category = self.doubao_client.classify_image(image_path)
                classified[category].append(image_path)
            except Exception as e:
                print(f"  分类失败，使用默认分类: {e}")
                classified['body'].append(image_path)

        return classified

    def extract_parameters(self, classified_images: Dict[str, List[Path]]) -> Dict:
        """
        步骤2: 从分类后的图片中提取参数

        Args:
            classified_images: 分类后的图片字典

        Returns:
            提取的参数字典
        """
        self.logger.info("开始提取汽车参数")

        if self.use_doubao:
            parameters = self._extract_with_doubao(classified_images)
        else:
            parameters = self.extractor.extract_all_parameters(classified_images)

        # 保存参数
        params_path = self.output_dir / "car_parameters.json"
        with open(params_path, 'w', encoding='utf-8') as f:
            json.dump(parameters, f, indent=2, ensure_ascii=False)

        self.logger.info(f"参数提取完成，保存到: {params_path}")

        return parameters

    def _extract_with_doubao(self, classified_images: Dict[str, List[Path]]) -> Dict:
        """使用豆包提取参数"""
        parameters = {}

        for category, images in classified_images.items():
            if images:
                self.logger.info(f"  提取 {category} 参数 ({len(images)} 张图片)")
                try:
                    params = self.doubao_client.analyze_car_parameters(images, category)
                    parameters[category] = params
                except Exception as e:
                    self.logger.error(f"  提取失败: {e}")
                    parameters[category] = {}
            else:
                parameters[category] = {}

        return parameters

    def generate_consistency_images(
        self,
        classified_images: Dict[str, List[Path]],
        parameters: Dict
    ) -> Dict[str, Path]:
        """
        步骤3: 使用Gemini多图融合API生成一致性控制的图片

        Args:
            classified_images: 分类后的图片
            parameters: 提取的参数

        Returns:
            生成的图片路径字典
        """
        self.logger.info("开始生成一致性控制图片（使用Gemini多图融合）")

        generated_images = {}

        # 生成三视图（前、侧、后）- 使用车身图作为参考
        three_views = ['front_view', 'side_view', 'rear_view']
        body_images = classified_images.get('body', [])

        for view in three_views:
            self.logger.info(f"生成 {view}（基于{len(body_images)}张参考图）")
            image_path = self.api_client.generate_view_with_refs(
                view=view,
                reference_images=body_images,
                parameters=parameters,
                output_dir=self.output_dir / "generated"
            )
            generated_images[view] = image_path

        # 生成细节图（轮毂、车标、传感器雷达、灯组）- 使用对应类别的图作为参考
        detail_categories = {
            'wheel': 'wheel',
            'logo': 'logo',
            'sensor_radar': 'sensor',
            'lights': 'lights'
        }

        for output_name, input_category in detail_categories.items():
            reference_images = classified_images.get(input_category, [])
            if reference_images:
                self.logger.info(f"生成 {output_name} 细节图（基于{len(reference_images)}张参考图）")
                image_path = self.api_client.generate_detail_with_refs(
                    category=output_name,
                    reference_images=reference_images,
                    parameters=parameters,
                    output_dir=self.output_dir / "generated"
                )
                generated_images[output_name] = image_path
            else:
                self.logger.warning(f"未找到 {input_category} 类别的参考图片")

        # 保存生成结果清单
        result_manifest = {
            name: str(path) for name, path in generated_images.items()
        }
        manifest_path = self.output_dir / "generated_manifest.json"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(result_manifest, f, indent=2, ensure_ascii=False)

        self.logger.info(f"图片生成完成，共生成 {len(generated_images)} 张图片")
        self.logger.info(f"生成清单保存到: {manifest_path}")

        return generated_images

    def run(self) -> Dict[str, Path]:
        """
        运行完整流程

        Returns:
            最终生成的图片路径字典
        """
        self.logger.info("=" * 60)
        self.logger.info("开始执行汽车模型一致性控制流程")
        self.logger.info("=" * 60)

        try:
            # 步骤1: 图片分类
            classified_images = self.classify_images()

            # 步骤2: 参数提取
            parameters = self.extract_parameters(classified_images)

            # 步骤3: 生成一致性图片
            generated_images = self.generate_consistency_images(
                classified_images,
                parameters
            )

            self.logger.info("=" * 60)
            self.logger.info("流程执行完成！")
            self.logger.info(f"输出目录: {self.output_dir}")
            self.logger.info("=" * 60)

            return generated_images

        except Exception as e:
            self.logger.error(f"执行过程中出现错误: {str(e)}")
            raise


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description='汽车模型一致性控制系统'
    )
    parser.add_argument(
        '--input-dir',
        type=str,
        required=True,
        help='输入图片目录路径'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./output',
        help='输出目录路径'
    )
    parser.add_argument(
        '--api-key',
        type=str,
        required=True,
        help='API密钥'
    )
    parser.add_argument(
        '--use-doubao',
        action='store_true',
        default=True,
        help='使用豆包进行分类和参数提取（默认开启，更便宜）'
    )
    parser.add_argument(
        '--no-doubao',
        action='store_false',
        dest='use_doubao',
        help='不使用豆包，改用Claude Vision（需要ANTHROPIC_API_KEY）'
    )

    args = parser.parse_args()

    # 创建控制器并运行
    controller = CarModelConsistencyController(
        input_dir=args.input_dir,
        output_dir=args.output_dir,
        api_key=args.api_key,
        use_doubao=args.use_doubao
    )

    controller.run()


if __name__ == '__main__':
    main()
