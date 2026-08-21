"""
Kunpeng COS Transit — SCF Cloud Function

Receives a remote file URL (e.g. volcano CDN video), downloads it server-side,
uploads to COS, and returns the COS public URL for fast mainland download.

Deploy: Tencent SCF, Hong Kong (ap-hongkong), Python 3.9, 256MB, 300s timeout.
Package with cos-python-sdk-v5 + urllib3<2 in the zip.

Environment variables:
  COS_BUCKET    — e.g. my-images-1250000000 (REQUIRED, your own bucket)
  COS_REGION    — e.g. ap-guangzhou
  COS_SECRET_ID — AKID...
  COS_SECRET_KEY — ...
"""
import json
import os
import time
import urllib.request
from qcloud_cos import CosConfig, CosS3Client

BUCKET = os.environ.get('COS_BUCKET', '')
REGION = os.environ.get('COS_REGION', 'ap-guangzhou')
SECRET_ID = os.environ.get('COS_SECRET_ID', '')
SECRET_KEY = os.environ.get('COS_SECRET_KEY', '')


def main_handler(event, context):
    if not BUCKET or not SECRET_ID or not SECRET_KEY:
        return {'statusCode': 500, 'body': json.dumps({'error': 'COS_BUCKET / COS_SECRET_ID / COS_SECRET_KEY env vars are required'})}
    try:
        body = json.loads(event.get('body', '{}'))
    except Exception:
        return {'statusCode': 400, 'body': json.dumps({'error': 'invalid JSON body'})}

    remote_url = body.get('url', '')
    if not remote_url:
        return {'statusCode': 400, 'body': json.dumps({'error': 'missing url field'})}

    file_name = body.get('fileName', f'transit_{int(time.time())}')
    content_type = body.get('contentType', 'video/mp4')

    req = urllib.request.Request(remote_url, headers={'User-Agent': 'KunpengTransit/1.0'})
    data = urllib.request.urlopen(req, timeout=240).read()

    config = CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)
    client = CosS3Client(config)
    cos_key = f'kunpeng/transit/{file_name}'
    client.put_object(Bucket=BUCKET, Body=data, Key=cos_key, ContentType=content_type)

    cos_url = f'https://{BUCKET}.cos.{REGION}.myqcloud.com/{cos_key}'

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'cosUrl': cos_url, 'size': len(data)})
    }
