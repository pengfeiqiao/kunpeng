# 鲲鹏（Kunpeng）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 一个跑在你电脑上的中文 AIGC 创作工作台：对话编程、画布、工坊、剪辑、文案，一站式完成从灵感到成片。

鲲鹏是一款基于 Tauri（React + Rust）的本地桌面应用，内嵌 DeepSeek Harness 引擎，把「对话式 AI 编程助手」和「AI 内容创作流水线」装进同一个窗口。

<!-- 截图占位：此处放主界面截图 / 功能演示 GIF（docs/images/ 下），开源前补充 -->

## 能力清单

- **对话**：内置 Agent 对话编程助手，支持 DeepSeek / GLM / Kimi 多模型路由，DeepSeek 走内嵌的 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 引擎（ACP/MCP 桥），GLM / Kimi 走自研 agent loop。
- **画布**：可视化节点画布，图片 / 视频 / 音频资产的生成、引用、编排与回传。
- **工坊**：分镜 / 脚本驱动的批量内容生产，风格库、角色资产、多引擎出图出视频。
- **剪辑**：AI 剪辑与口播审片，ASR 转写、字级拖选删除、时间线工具。
- **文案**：AI 写作工作室，长文撰写与增量编辑。

## 安装

### 下载安装包（macOS）

从 [Releases](../../releases) 页面下载最新的 `.dmg`，拖入「应用程序」即可。

> **未签名应用的 Gatekeeper 提示**：当前发布包未做 Apple 开发者签名，首次打开可能提示「无法打开，因为无法验证开发者」或「已损坏」。解决方法二选一：
>
> 1. 在 Finder 中**右键点击应用图标 → 打开**，在弹窗中再点「打开」；
> 2. 打开过一次被拦后，进入 **系统设置 → 隐私与安全性**，在底部找到鲲鹏的拦截记录，点「**仍要打开**」。
>
> 如提示「已损坏，移到废纸篓」，可在终端执行 `xattr -cr /Applications/鲲鹏.app` 后重试。

### 从源码构建

见下文 [从源码构建](#从源码构建)。

## 5 分钟上手

1. **获取 DeepSeek API Key**：前往 <https://platform.deepseek.com> 注册并创建 API Key。
2. **首次启动引导**：启动鲲鹏后按引导填入 API Key，即可完成基础配置（其它模型渠道可之后再配）。
3. **跑第一条任务**：在对话窗口输入一句需求，例如「帮我把这张参考图做成 15 秒的口播视频分镜」，观察 Agent 调用工具、产出结果的全过程。

<!-- 截图占位：首次启动引导页 / 第一条任务演示 GIF -->

## 配置

### 对话模型

| 渠道 | 说明 | 备注 |
| --- | --- | --- |
| DeepSeek | 默认推荐，走内嵌 DeepSeek Harness 引擎（ACP/MCP 桥） | 需 API Key（platform.deepseek.com） |
| GLM（智谱） | 自研 agent loop | 需 API Key |
| Kimi（Moonshot） | 自研 agent loop | 需 API Key |

### 图像 / 视频生成渠道

| 渠道类型 | 说明 | 备注 |
| --- | --- | --- |
| 图像生成 | 多家图像引擎可选（如 Seedream 系、GPT-Image 系、MJ 系等） | 部分渠道**需自行配置 endpoint 与密钥** |
| 视频生成 | 多家视频引擎可选（如 Seedance 系等） | 部分渠道**需自行配置 endpoint 与密钥** |
| 语音 / ASR | 配音、语音转写等 | 部分渠道**需自行配置 endpoint 与密钥** |

> **第三方渠道声明**：第三方渠道为用户自配，本项目不担保其可用性与价格。请自行评估各渠道的服务条款、稳定性与计费规则。

## 从源码构建

环境要求：Node.js 20+、Rust 工具链（rustup）、macOS（当前主要支持平台）。

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run tauri:dev

# 打包（公共构建为纯净版，不含任何私人资源）
npm run tauri:build
```

说明：

- 打包走 `scripts/tauri-build.mjs` 包装器；公共仓库的构建默认是纯净版。
- 应用内嵌的 `dsh-runtime/node`（Node.js 运行时）是 gitignored 的本地下载件，源码构建前需自行准备（参考 `.github/workflows/release.yml` 中的下载步骤）。
- 常用测试：`npm run test:harness`、`npm run test:dsh-runtime`、`npm run test:omni`、`npm run test:context`；Rust 侧：`cargo check --manifest-path src-tauri/Cargo.toml`。

## 架构简图

```
┌──────────────────────────── 前端（React）────────────────────────────┐
│  对话 / 画布 / 工坊 / 剪辑 / 文案                                     │
│        │                                                            │
│     useAgent（对话编排 Hook）                                         │
│        │                                                            │
│   模型路由（providers/router）                                        │
│     ├── GLM / Kimi ────────── 自研 agent loop                       │
│     └── DeepSeek ──────────── DeepSeek Harness 引擎                  │
│                               （dsh-runtime，ACP / MCP 桥）          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Tauri IPC
┌──────────────────────────────▼──────────────────────────────────────┐
│   Rust 后端（src-tauri）：文件系统 / 命令执行 / 协议 / 系统集成        │
└─────────────────────────────────────────────────────────────────────┘
```

## 参与贡献

欢迎 Issue 和 PR！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

> 本项目为个人业余项目，Issue 会尽力回应，但无法保证响应时效，感谢理解。

行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，安全问题报告见 [SECURITY.md](SECURITY.md)。

## 第三方声明与 License

- 本项目以 [MIT License](LICENSE) 开源。
- 第三方组件声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（含 DeepSeek Harness、Node.js、sharp/libvips 等）。
- 更新记录见 [CHANGELOG.md](CHANGELOG.md)。
