#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
汽车数据库管理系统
功能：保存、查询、管理汽车模型数据
"""

from pathlib import Path
import json
import shutil
from datetime import datetime


class CarDatabase:
    """汽车数据库管理器"""

    def __init__(self, database_path: Path = None):
        """
        初始化数据库

        Args:
            database_path: 数据库根目录
        """
        self.database_path = database_path or Path("./car_database")
        self.database_path.mkdir(parents=True, exist_ok=True)

        # 数据库索引文件
        self.index_file = self.database_path / "index.json"
        self.index = self._load_index()

    def _load_index(self) -> dict:
        """加载数据库索引"""
        if self.index_file.exists():
            with open(self.index_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"cars": [], "last_updated": None}

    def _save_index(self):
        """保存数据库索引"""
        self.index["last_updated"] = datetime.now().isoformat()
        with open(self.index_file, 'w', encoding='utf-8') as f:
            json.dump(self.index, f, ensure_ascii=False, indent=2)

    def save_car_model(
        self,
        brand: str,
        model: str,
        classification_result: dict,
        generated_dir: Path,
        reference_dir: Path = None,
        metadata: dict = None
    ) -> Path:
        """
        保存车型到数据库

        Args:
            brand: 品牌名称
            model: 车型名称
            classification_result: 分类结果
            generated_dir: 生成图片目录
            reference_dir: 参考图目录（可选）
            metadata: 额外元数据

        Returns:
            保存的目录路径
        """
        print(f"\n{'='*60}")
        print(f"保存车型到数据库: {brand} {model}")
        print(f"{'='*60}")

        # 创建车型目录
        car_dir = self.database_path / brand / model
        car_dir.mkdir(parents=True, exist_ok=True)

        # 1. 保存分类结果
        classification_file = car_dir / "classification_result.json"
        with open(classification_file, 'w', encoding='utf-8') as f:
            json.dump(classification_result, f, ensure_ascii=False, indent=2)
        print(f"  [OK] 分类结果: {classification_file}")

        # 2. 复制生成的图片
        generated_target = car_dir / "generated"
        if generated_target.exists():
            shutil.rmtree(generated_target)
        shutil.copytree(generated_dir, generated_target)

        # 统计图片
        images = list(generated_target.glob("*.jpg"))
        total_size = sum(img.stat().st_size for img in images) / (1024 * 1024)
        print(f"  [OK] 生成图片: {len(images)}张, {total_size:.1f}MB")

        # 3. 复制参考图（可选）
        if reference_dir and reference_dir.exists():
            reference_target = car_dir / "reference"
            if reference_target.exists():
                shutil.rmtree(reference_target)
            shutil.copytree(reference_dir, reference_target)
            ref_images = list(reference_target.glob("*.*"))
            print(f"  [OK] 参考图: {len(ref_images)}张")

        # 4. 创建元数据
        car_metadata = {
            "brand": brand,
            "model": model,
            "date_created": datetime.now().isoformat(),
            "images_count": len(images),
            "total_size_mb": round(total_size, 2),
            "images": [img.name for img in images],
            "classification": {
                "body": len(classification_result.get("body", [])),
                "wheel": len(classification_result.get("wheel", [])),
                "lights": len(classification_result.get("lights", [])),
                "sensor": len(classification_result.get("sensor", [])),
                "logo": len(classification_result.get("logo", []))
            }
        }

        # 合并额外元数据
        if metadata:
            car_metadata.update(metadata)

        # 保存元数据
        metadata_file = car_dir / "metadata.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(car_metadata, f, ensure_ascii=False, indent=2)
        print(f"  [OK] 元数据: {metadata_file}")

        # 5. 更新数据库索引
        car_entry = {
            "brand": brand,
            "model": model,
            "path": str(car_dir.relative_to(self.database_path)),
            "date_created": car_metadata["date_created"],
            "images_count": car_metadata["images_count"],
            "total_size_mb": car_metadata["total_size_mb"]
        }

        # 检查是否已存在
        existing_index = next(
            (i for i, c in enumerate(self.index["cars"])
             if c["brand"] == brand and c["model"] == model),
            None
        )

        if existing_index is not None:
            self.index["cars"][existing_index] = car_entry
            print(f"  [UPDATE] 更新数据库索引")
        else:
            self.index["cars"].append(car_entry)
            print(f"  [NEW] 添加到数据库索引")

        self._save_index()

        print(f"\n{'='*60}")
        print(f"保存完成: {car_dir}")
        print(f"{'='*60}")

        return car_dir

    def list_cars(self) -> list:
        """列出数据库中的所有车型"""
        return self.index["cars"]

    def get_car(self, brand: str, model: str) -> dict:
        """
        获取车型信息

        Args:
            brand: 品牌名称
            model: 车型名称

        Returns:
            车型信息字典
        """
        car_dir = self.database_path / brand / model

        if not car_dir.exists():
            raise FileNotFoundError(f"车型不存在: {brand} {model}")

        # 读取元数据
        metadata_file = car_dir / "metadata.json"
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

        # 读取分类结果
        classification_file = car_dir / "classification_result.json"
        with open(classification_file, 'r', encoding='utf-8') as f:
            classification = json.load(f)

        return {
            "metadata": metadata,
            "classification": classification,
            "path": car_dir
        }

    def delete_car(self, brand: str, model: str):
        """
        删除车型

        Args:
            brand: 品牌名称
            model: 车型名称
        """
        car_dir = self.database_path / brand / model

        if car_dir.exists():
            shutil.rmtree(car_dir)
            print(f"[OK] 已删除: {brand} {model}")

            # 更新索引
            self.index["cars"] = [
                c for c in self.index["cars"]
                if not (c["brand"] == brand and c["model"] == model)
            ]
            self._save_index()
        else:
            print(f"[SKIP] 车型不存在: {brand} {model}")

    def print_summary(self):
        """打印数据库摘要"""
        print(f"\n{'='*60}")
        print(f"汽车数据库摘要")
        print(f"{'='*60}")
        print(f"数据库路径: {self.database_path}")
        print(f"车型总数: {len(self.index['cars'])}")
        print(f"最后更新: {self.index.get('last_updated', 'N/A')}")

        if self.index["cars"]:
            print(f"\n车型列表:")
            for i, car in enumerate(self.index["cars"], 1):
                print(f"  {i}. {car['brand']} {car['model']}")
                print(f"     - 图片: {car['images_count']}张")
                print(f"     - 大小: {car['total_size_mb']}MB")
                print(f"     - 日期: {car['date_created'][:10]}")
        else:
            print(f"\n数据库为空")

        print(f"{'='*60}")


def save_nio_es8_to_database():
    """保存蔚来ES8到数据库"""
    print("="*60)
    print("保存蔚来ES8到数据库")
    print("="*60)

    # 创建数据库
    db = CarDatabase()

    # 读取分类结果
    classification_file = Path("output_full_test/classification_result.json")
    with open(classification_file, 'r', encoding='utf-8') as f:
        classification = json.load(f)

    # 生成图片目录
    generated_dir = Path("output_v3_enhanced/generated")

    # 参考图目录
    reference_dir = Path(r"C:\Users\38684\Desktop\蔚来es8")

    # 额外元数据
    metadata = {
        "version": "3.0",
        "strategy": "V3极简策略",
        "quality_score": "4.9/5",
        "cost": "$0.43",
        "status": "完全成功",
        "notes": "完美完成，所有细节准确，车牌已隐藏",
        "special_features": [
            "车牌黑色覆盖",
            "灯组细分（前后分离）",
            "专业展示图（21:9超宽屏）"
        ]
    }

    # 保存到数据库
    car_dir = db.save_car_model(
        brand="NIO",
        model="ES8",
        classification_result=classification,
        generated_dir=generated_dir,
        reference_dir=reference_dir,
        metadata=metadata
    )

    # 打印摘要
    db.print_summary()

    return car_dir


if __name__ == "__main__":
    save_nio_es8_to_database()
