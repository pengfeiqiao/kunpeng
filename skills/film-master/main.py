#!/usr/bin/env python3
"""
电影大师 - BananaPro 图像生成脚本
支持：单张/多张生成，多种画面比例，URL 和 base64 响应格式
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

RATIO_SIZE_MAP = {
    '2.39:1': {'1K': (1280,  536), '2K': (2560, 1072), '4K': (3840, 1608)},
    '16:9':   {'1K': (1280,  720), '2K': (1920, 1080), '4K': (3840, 2160)},
    '9:16':   {'1K': ( 720, 1280), '2K': (1080, 1920), '4K': (2160, 3840)},
    '1:1':    {'1K': (1024, 1024), '2K': (2048, 2048), '4K': (4096, 4096)},
}

DEFAULT_OUTPUT_DIR = os.path.join(os.path.expanduser('~'), 'Desktop', 'film-output')


def parse_args():
    parser = argparse.ArgumentParser(description='BananaPro 电影大师图像生成')
    parser.add_argument('--api-key',    required=True,  help='BananaPro API Key')
    parser.add_argument('--prompt',     required=True,  help='生成提示词')
    parser.add_argument('--ratio',      default='16:9', help='画面比例 (2.39:1 / 16:9 / 9:16 / 1:1)')
    parser.add_argument('--resolution', default='2K',   help='输出分辨率 (1K / 2K / 4K)')
    parser.add_argument('--count',      type=int, default=1, help='生成张数（1/2/4）')
    parser.add_argument('--output-dir', default=None,   help='输出目录，默认 ~/Desktop/film-output/')
    parser.add_argument('--api-base',   default='https://api.bananapro.ai/v1', help='API Base URL')
    parser.add_argument('--model',      default='imagen-3-nano-banana-pro', help='模型名称')
    return parser.parse_args()


def call_api(api_base, api_key, model, prompt, width, height):
    payload = json.dumps({
        'model': model,
        'prompt': prompt,
        'n': 1,
        'size': f'{width}x{height}',
        'response_format': 'url',
    }).encode('utf-8')

    req = urllib.request.Request(
        f'{api_base}/images/generations',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'[错误] API 返回 {e.code}: {body}', file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f'[错误] 网络请求失败: {e.reason}', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'[错误] 请求异常: {e}', file=sys.stderr)
        sys.exit(1)


def download_image(url, save_path):
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            with open(save_path, 'wb') as f:
                f.write(resp.read())
    except Exception as e:
        print(f'[错误] 图片下载失败: {e}', file=sys.stderr)
        sys.exit(1)


def save_b64_image(b64_data, save_path):
    try:
        img_bytes = base64.b64decode(b64_data)
        with open(save_path, 'wb') as f:
            f.write(img_bytes)
    except Exception as e:
        print(f'[错误] base64 解码失败: {e}', file=sys.stderr)
        sys.exit(1)


def main():
    args = parse_args()

    ratio_map = RATIO_SIZE_MAP.get(args.ratio, RATIO_SIZE_MAP['16:9'])
    width, height = ratio_map.get(args.resolution, ratio_map['2K'])
    output_dir = args.output_dir or DEFAULT_OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)

    timestamp = time.strftime('%Y%m%d_%H%M%S')
    saved_paths = []

    print(f'[电影大师] 开始生成，共 {args.count} 张，比例 {args.ratio} {args.resolution} ({width}x{height})')
    print(f'[电影大师] 输出目录: {output_dir}')

    for i in range(args.count):
        idx = i + 1
        print(f'[电影大师] 正在生成第 {idx}/{args.count} 张...')

        result = call_api(args.api_base, args.api_key, args.model, args.prompt, width, height)

        data = result.get('data', [])
        if not data:
            print(f'[错误] API 返回空数据: {json.dumps(result, ensure_ascii=False)}', file=sys.stderr)
            sys.exit(1)

        item = data[0]
        suffix = f'_{idx}' if args.count > 1 else ''
        save_path = os.path.join(output_dir, f'film_{timestamp}{suffix}.png')

        if 'url' in item:
            download_image(item['url'], save_path)
        elif 'b64_json' in item:
            save_b64_image(item['b64_json'], save_path)
        else:
            print(f'[错误] 未知响应格式: {list(item.keys())}', file=sys.stderr)
            sys.exit(1)

        saved_paths.append(save_path)
        print(f'[电影大师] ✓ 已保存: {save_path}')

        # 多张生成间隔，避免 rate limit
        if i < args.count - 1:
            time.sleep(1)

    print(f'\n[电影大师] 生成完成！共 {len(saved_paths)} 张图片')
    print('图片路径：')
    for p in saved_paths:
        print(f'  {p}')


if __name__ == '__main__':
    main()
