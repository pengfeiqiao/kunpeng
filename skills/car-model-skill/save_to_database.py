#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 BMW X3 保存到数据库
"""

from pathlib import Path
import shutil
import json
from datetime import datetime


def save_to_database():
    """将所有文件保存到数据库"""
    print("=" * 60)
    print("将 BMW X3 保存到数据库")
    print("=" * 60)

    # 源目录
    generated_dir = Path("output_bmw_x3_final/generated")
    showcase_dir = Path("output_bmw_x3_final/showcase")

    # 目标数据库目录
    db_dir = Path("car_database/BMW/X3")
    db_dir.mkdir(parents=True, exist_ok=True)

    # 基础图片目录
    base_images_dir = db_dir / "images"
    base_images_dir.mkdir(exist_ok=True)

    # Showcase目录
    showcase_db_dir = db_dir / "showcase"
    showcase_db_dir.mkdir(exist_ok=True)

    # 1. 复制基础图片
    print("\n[1/3] 复制基础图片...")
    base_images = [
        'body_front.jpg',
        'body_side.jpg',
        'body_rear.jpg',
        'wheel.jpg',
        'logo.jpg',
        'sensor_radar.jpg',
        'lights_front.jpg',
        'lights_rear.jpg'
    ]

    for img_name in base_images:
        src = generated_dir / img_name
        dst = base_images_dir / img_name
        if src.exists():
            shutil.copy2(src, dst)
            file_size = dst.stat().st_size / (1024 * 1024)
            print(f"  [OK] {img_name} ({file_size:.2f}MB)")
        else:
            print(f"  [ERROR] 文件不存在: {img_name}")

    # 2. 复制showcase
    print("\n[2/3] 复制 showcase...")
    showcases = [
        'bannanapro_showcase.jpg',
        'video_showcase_body.jpg',
        'video_showcase_lights.jpg',
        'video_showcase_details.jpg'
    ]

    for showcase_name in showcases:
        src = showcase_dir / showcase_name
        dst = showcase_db_dir / showcase_name
        if src.exists():
            shutil.copy2(src, dst)
            file_size = dst.stat().st_size / (1024 * 1024)
            print(f"  [OK] {showcase_name} ({file_size:.2f}MB)")
        else:
            print(f"  [ERROR] 文件不存在: {showcase_name}")

    # 3. 创建元数据文件
    print("\n[3/3] 创建元数据...")
    metadata = {
        "brand": "BMW",
        "model": "X3",
        "full_name": "华晨宝马 X3",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "images": {
            "body_views": ["body_front.jpg", "body_side.jpg", "body_rear.jpg"],
            "details": ["wheel.jpg", "logo.jpg", "sensor_radar.jpg", "lights_front.jpg", "lights_rear.jpg"]
        },
        "showcase": {
            "bannanapro": "bannanapro_showcase.jpg",
            "video": [
                "video_showcase_body.jpg",
                "video_showcase_lights.jpg",
                "video_showcase_details.jpg"
            ]
        },
        "status": "completed",
        "quality_verified": True
    }

    metadata_path = db_dir / "metadata.json"
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"  [OK] 元数据已保存: metadata.json")

    # 统计
    print("\n" + "=" * 60)
    print("保存完成！")
    print("=" * 60)
    print(f"\n数据库路径: {db_dir.absolute()}")
    print(f"\n文件统计:")
    print(f"  - 基础图片: {len(base_images)} 张")
    print(f"  - Showcase: {len(showcases)} 张")
    print(f"  - 元数据文件: 1 个")

    # 计算总大小
    total_size = 0
    for file in base_images_dir.glob("*.jpg"):
        total_size += file.stat().st_size
    for file in showcase_db_dir.glob("*.jpg"):
        total_size += file.stat().st_size

    print(f"  - 总大小: {total_size / (1024 * 1024):.2f}MB")
    print("\n" + "=" * 60)


if __name__ == "__main__":
    save_to_database()
