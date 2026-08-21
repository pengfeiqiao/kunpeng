#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理临时文件脚本
删除所有临时测试文件、输出目录和临时文档
"""

from pathlib import Path
import shutil


def cleanup_temp_files():
    """清理所有临时文件"""
    print("=" * 60)
    print("清理临时文件")
    print("=" * 60)

    # 当前目录
    root_dir = Path(".")

    # 要删除的临时Python文件
    temp_py_files = [
        "analyze_and_optimize_prompt.py",
        "analyze_body_front.py",
        "analyze_body_rear_v1.py",
        "analyze_body_rear_v2.py",
        "analyze_differences.py",
        "analyze_lights.py",
        "analyze_lights_rear.py",
        "analyze_lights_rear_v4.py",
        "check_body_rear_v3.py",
        "comprehensive_analysis.py",
        "create_bannanapro_premium.py",
        "create_showcase_body.py",
        "create_showcase_composite.py",
        "create_showcase_details.py",
        "create_showcase_premium.py",
        "create_showcases.py",
        "create_video_showcases_optimized.py",
        "deep_analysis.py",
        "demo.py",
        "direct_compare.py",
        "fetch_banana_docs.py",
        "fetch_doubao_docs.py",
        "fetch_multi_image_docs.py",
        "fix_video_body_final.py",
        "fix_video_showcase_body.py",
        "generate_bmw_x3.py",
        "generate_brand_logo.py",
        "generate_logo_from_body.py",
        "generate_rear_logo.py",
        "generate_showcase.py",
        "generate_v3_enhanced.py",
        "reanalyze_problem.py",
        "regenerate_bmw_x3.py",
        "regenerate_body_rear.py",
        "regenerate_body_rear_only.py",
        "regenerate_body_views.py",
        "regenerate_car_logo.py",
        "regenerate_details_optimized.py",
        "regenerate_lights_rear_single.py",
        "regenerate_rear_images.py",
        "regenerate_rear_lights.py",
        "regenerate_with_logo.py",
        "save_nio_es8_to_db.py",
        "test_api.py",
        "test_doubao_classify.py",
        "test_doubao_text.py",
        "test_doubao_vision.py",
        "test_full.py",
        "test_gemini_multiref.py",
        "test_multiref_generation.py",
        "test_v3_simple_regenerate.py",
    ]

    # 要删除的临时目录
    temp_dirs = [
        "api_test_output",
        "demo_output",
        "multi_image_test_output",
        "output_bmw_x3",
        "output_bmw_x3_v3",
        "output_full_test",
        "output_multiref_test",
        "output_optimized",
        "output_v3_enhanced",
        "output_v3_simple",
        "test_doubao_output",
        "showcase_web",
    ]

    # 要删除的临时文档
    temp_docs = [
        "FINAL_REPORT.md",
        "MULTIREF_COMPARISON_REPORT.md",
        "OPTIMIZATION_REPORT.md",
        "PROJECT_COMPLETION_SUMMARY.md",
        "PROJECT_FINAL_SUMMARY.md",
        "PROJECT_SUMMARY.md",
        "PROMPT_COMPARISON_V2_VS_V3.md",
        "TODO.md",
        "USAGE.md",
        "V3_QUICKSTART.md",
        "V3_SIMPLE_STRATEGY.md",
    ]

    # 要删除的临时JSON文件
    temp_json_files = [
        "banana_docs.json",
        "doubao_docs.json",
        "multi_image_docs.json",
        "detail_difference_analysis.json",
        "direct_comparison_results.json",
    ]

    # 要删除的临时其他文件
    temp_other_files = [
        "full_test_010129.log",
        "full_test_output.txt",
        "run_test.bat",
        "run_test.sh",
        "run_v3_test.bat",
    ]

    # 统计
    deleted_files = 0
    deleted_dirs = 0
    failed_deletions = []

    # 删除Python文件
    print("\n删除临时Python文件...")
    for file_name in temp_py_files:
        file_path = root_dir / file_name
        if file_path.exists():
            try:
                file_path.unlink()
                deleted_files += 1
                print(f"  [OK] {file_name}")
            except Exception as e:
                failed_deletions.append((file_name, str(e)))
                print(f"  [ERROR] {file_name}: {e}")

    # 删除临时目录
    print("\n删除临时目录...")
    for dir_name in temp_dirs:
        dir_path = root_dir / dir_name
        if dir_path.exists():
            try:
                shutil.rmtree(dir_path)
                deleted_dirs += 1
                print(f"  [OK] {dir_name}/")
            except Exception as e:
                failed_deletions.append((dir_name, str(e)))
                print(f"  [ERROR] {dir_name}/: {e}")

    # 删除临时文档
    print("\n删除临时文档...")
    for file_name in temp_docs:
        file_path = root_dir / file_name
        if file_path.exists():
            try:
                file_path.unlink()
                deleted_files += 1
                print(f"  [OK] {file_name}")
            except Exception as e:
                failed_deletions.append((file_name, str(e)))
                print(f"  [ERROR] {file_name}: {e}")

    # 删除临时JSON文件
    print("\n删除临时JSON文件...")
    for file_name in temp_json_files:
        file_path = root_dir / file_name
        if file_path.exists():
            try:
                file_path.unlink()
                deleted_files += 1
                print(f"  [OK] {file_name}")
            except Exception as e:
                failed_deletions.append((file_name, str(e)))
                print(f"  [ERROR] {file_name}: {e}")

    # 删除其他临时文件
    print("\n删除其他临时文件...")
    for file_name in temp_other_files:
        file_path = root_dir / file_name
        if file_path.exists():
            try:
                file_path.unlink()
                deleted_files += 1
                print(f"  [OK] {file_name}")
            except Exception as e:
                failed_deletions.append((file_name, str(e)))
                print(f"  [ERROR] {file_name}: {e}")

    # 总结
    print("\n" + "=" * 60)
    print("清理完成")
    print("=" * 60)
    print(f"删除文件: {deleted_files}")
    print(f"删除目录: {deleted_dirs}")

    if failed_deletions:
        print(f"\n失败删除: {len(failed_deletions)}")
        for item, error in failed_deletions:
            print(f"  - {item}: {error}")

    print("\n保留的文件和目录:")
    print("  - src/ (核心源代码)")
    print("  - config/ (配置文件)")
    print("  - templates/ (模板)")
    print("  - examples/ (示例)")
    print("  - car_database/ (数据库)")
    print("  - output_bmw_x3_final/ (最终输出)")
    print("  - gemini_multiref_client_v3_simple.py (旧客户端，保留作参考)")
    print("  - doubao_vision_client.py (旧分析器，保留作参考)")
    print("  - car_database_manager.py (数据库管理器)")
    print("  - README_NEW.md (新文档)")
    print("  - skill.json (元数据)")
    print("  - requirements.txt (依赖)")
    print("=" * 60)


if __name__ == "__main__":
    cleanup_temp_files()
