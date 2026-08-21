---
type: memory-router
category: quality-gates
version: 1
---

# 生成前检查路由

本目录用于提交 API 前的质量门禁。

## 必读

- `pre-generation.md`：所有生图、生视频、飞书写入前的总检查清单。

## 执行原则

1. 检查失败时先修正，不提交生成。
2. Seedance 视频提示词以 `prompt-templates/seedance/README.md` 为准。
3. 图片引用必须按实际上传顺序核对。
4. 任何文件名引用必须确认文件真实存在。

