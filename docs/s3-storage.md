# 自定义 S3 / MinIO 存储配置

鲲鹏的“设置 → 存储与集成 → 自定义 S3 兼容存储”支持 AWS S3、MinIO、Cloudflare R2 和其他兼容 S3 API 的服务。

## Linux 部署 MinIO

下面示例使用 Docker。生产环境请替换默认账号密码，并把数据目录放在持久化磁盘上：

```bash
mkdir -p /srv/kunpeng-minio/data
docker run -d --name kunpeng-minio --restart unless-stopped \
  -p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001 \
  -e MINIO_ROOT_USER='replace-with-access-key' \
  -e MINIO_ROOT_PASSWORD='replace-with-a-long-secret' \
  -v /srv/kunpeng-minio/data:/data \
  quay.io/minio/minio server /data --console-address ':9001'
```

访问 `http://127.0.0.1:9001` 创建一个 Bucket，例如 `kunpeng-media`，再为应用创建只允许访问该 Bucket 的 Access Key。不要把 Root 凭据填入桌面客户端。

## Nginx HTTPS 反代

准备域名 `s3.example.com` 并把 DNS 指向服务器。证书可以由 Certbot 或现有网关管理。Nginx 核心配置如下：

```nginx
server {
    listen 443 ssl http2;
    server_name s3.example.com;

    ssl_certificate /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    client_max_body_size 2G;
    location / {
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:9000;
    }
}
```

验证反代后，Endpoint 应填写 `https://s3.example.com`，不要填写控制台端口 `9001`。

## 鲲鹏中的填写示例

| 配置项 | MinIO 示例 |
| --- | --- |
| Endpoint | `https://s3.example.com` |
| Region | `us-east-1` |
| Bucket | `kunpeng-media` |
| Access Key ID | MinIO 创建的应用 Access Key |
| Secret Access Key | 对应 Secret Key |
| Object Prefix | `kunpeng` |
| 公网访问基础 URL | `https://s3.example.com` |
| Path-style | MinIO 通常勾选 |

填写 Endpoint 后，画布以及图片、视频、音频上传会优先使用 S3；Endpoint 留空则继续使用 MinIO 上传 API或腾讯云 COS。

## 公网访问与安全

当前上传返回的是对象 URL，不会在客户端自动生成预签名下载 URL。因此对象必须能被应用运行环境访问：可以使用公开读 Bucket，也可以填写指向公开 CDN/反代的“公网访问基础 URL”。如果 Bucket 必须完全私有，应先在网关增加鉴权或后续接入预签名 URL。

- 只开放 HTTPS，不要把 MinIO 的 9000 端口直接暴露到公网；
- 使用最小权限的应用 Access Key，不要使用 Root 凭据；
- Secret Access Key 仅保存在鲲鹏本地设置，不要提交到仓库、日志或截图；
- 配置防火墙、Bucket 生命周期和磁盘告警，避免临时媒体无限增长。
