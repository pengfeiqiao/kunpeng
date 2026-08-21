"""
场景图裁剪放大工具
====================================================
使用图像裁剪技术对场景图进行放大。

核心功能：
1. crop_and_upscale - 裁剪并放大指定区域
2. auto_crop_center - 自动裁剪中心区域并放大
3. crop_by_region_name - 根据区域名称裁剪

用法：
    from systems.scene.crop_upsampler import CropUpsampler

    upsampler = CropUpsampler()
    result = upsampler.crop_and_upscale(
        image_path="scene_concept.jpg",
        crop_region=(100, 100, 500, 500),  # x, y, width, height
        scale_factor=2.0
    )
"""

from pathlib import Path
from typing import Tuple, Optional
from dataclasses import dataclass


@dataclass
class CropResult:
    """裁剪结果"""
    success: bool
    output_path: Path = None
    message: str = ""
    original_size: Tuple[int, int] = None
    cropped_size: Tuple[int, int] = None


class CropUpsampler:
    """场景图裁剪放大工具"""

    # 预设裁剪区域（相对于图片尺寸的比例）
    REGION_PRESETS = {
        "center": (0.1, 0.1, 0.8, 0.8),      # 中心 80%
        "top_left": (0.0, 0.0, 0.6, 0.6),     # 左上角 60%
        "top_right": (0.4, 0.0, 0.6, 0.6),    # 右上角 60%
        "bottom_left": (0.0, 0.4, 0.6, 0.6),  # 左下角 60%
        "bottom_right": (0.4, 0.4, 0.6, 0.6), # 右下角 60%
    }

    def __init__(self, default_scale: float = 2.0):
        """
        初始化裁剪放大工具

        Args:
            default_scale: 默认放大倍数
        """
        self.default_scale = default_scale

    def crop_and_upscale(
        self,
        image_path: Path,
        output_path: Path = None,
        crop_region: Tuple[int, int, int, int] = None,
        scale_factor: float = None
    ) -> CropResult:
        """
        裁剪并放大指定区域

        Args:
            image_path: 原图路径
            output_path: 输出路径（可选）
            crop_region: 裁剪区域 (x, y, width, height)
            scale_factor: 放大倍数

        Returns:
            CropResult
        """
        try:
            from PIL import Image

            image_path = Path(image_path)
            if not image_path.exists():
                return CropResult(success=False, message=f"图片不存在: {image_path}")

            # 加载图片
            img = Image.open(image_path)
            original_size = img.size

            # 确定输出路径
            if output_path is None:
                output_path = image_path.parent / f"{image_path.stem}_upscaled{image_path.suffix}"
            else:
                output_path = Path(output_path)

            # 如果没有指定裁剪区域，使用中心区域
            if crop_region is None:
                crop_region = self._get_center_region(img.size)

            # 裁剪
            x, y, w, h = crop_region
            cropped = img.crop((x, y, x + w, y + h))
            cropped_size = cropped.size

            # 放大
            scale = scale_factor or self.default_scale
            new_size = (int(cropped.size[0] * scale), int(cropped.size[1] * scale))
            upscaled = cropped.resize(new_size, Image.Resampling.LANCZOS)

            # 保存
            upscaled.save(output_path, quality=95)

            return CropResult(
                success=True,
                output_path=output_path,
                message=f"裁剪放大完成",
                original_size=original_size,
                cropped_size=new_size
            )

        except ImportError:
            return CropResult(success=False, message="需要安装 Pillow 库: pip install Pillow")
        except Exception as e:
            return CropResult(success=False, message=f"裁剪放大失败: {str(e)}")

    def crop_by_region_name(
        self,
        image_path: Path,
        region_name: str = "center",
        output_path: Path = None,
        scale_factor: float = 2.0
    ) -> CropResult:
        """
        根据区域名称裁剪并放大

        Args:
            image_path: 原图路径
            region_name: 区域名称 (center, top_left, top_right, bottom_left, bottom_right)
            output_path: 输出路径
            scale_factor: 放大倍数

        Returns:
            CropResult
        """
        try:
            from PIL import Image

            image_path = Path(image_path)
            if not image_path.exists():
                return CropResult(success=False, message=f"图片不存在: {image_path}")

            img = Image.open(image_path)
            w, h = img.size

            # 获取预设区域
            preset = self.REGION_PRESETS.get(region_name, self.REGION_PRESETS["center"])
            rx, ry, rw, rh = preset

            # 计算实际像素坐标
            crop_region = (
                int(w * rx),
                int(h * ry),
                int(w * rw),
                int(h * rh)
            )

            return self.crop_and_upscale(
                image_path=image_path,
                output_path=output_path,
                crop_region=crop_region,
                scale_factor=scale_factor
            )

        except Exception as e:
            return CropResult(success=False, message=f"裁剪失败: {str(e)}")

    def auto_crop_center(
        self,
        image_path: Path,
        output_path: Path = None,
        crop_ratio: float = 0.8,
        scale_factor: float = 2.0
    ) -> CropResult:
        """
        自动裁剪中心区域并放大

        Args:
            image_path: 原图路径
            output_path: 输出路径
            crop_ratio: 裁剪比例（0.8 表示裁剪中心 80% 区域）
            scale_factor: 放大倍数

        Returns:
            CropResult
        """
        try:
            from PIL import Image

            image_path = Path(image_path)
            img = Image.open(image_path)

            # 计算中心裁剪区域
            w, h = img.size
            crop_w = int(w * crop_ratio)
            crop_h = int(h * crop_ratio)
            x = (w - crop_w) // 2
            y = (h - crop_h) // 2

            return self.crop_and_upscale(
                image_path=image_path,
                output_path=output_path,
                crop_region=(x, y, crop_w, crop_h),
                scale_factor=scale_factor
            )

        except Exception as e:
            return CropResult(success=False, message=f"自动裁剪失败: {str(e)}")

    def _get_center_region(self, size: Tuple[int, int], ratio: float = 0.8) -> Tuple[int, int, int, int]:
        """获取中心裁剪区域"""
        w, h = size
        crop_w = int(w * ratio)
        crop_h = int(h * ratio)
        x = (w - crop_w) // 2
        y = (h - crop_h) // 2
        return (x, y, crop_w, crop_h)
