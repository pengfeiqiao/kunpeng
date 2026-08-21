# 第三方声明（THIRD-PARTY-NOTICES）

本项目包含或依赖以下第三方组件。各自的许可证文本可在对应组件的源码仓库或安装目录中找到。

## 捆绑分发的主要组件

### DeepSeek Harness（@deepseek-ai/dsh 等）

- **版本**：`0.1.0-rc.6`（锁定版本，见 `dsh-runtime/package.json`）
- **许可证**：MIT
- **位置**：`dsh-runtime/node_modules/@deepseek-ai/`
- **上游**：<https://www.npmjs.com/package/@deepseek-ai/dsh>
- 说明：鲲鹏内嵌 DeepSeek Harness 引擎作为 DeepSeek 渠道的 agent 运行时（ACP/MCP 桥）。版本升级需全量回归，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### Node.js

- **版本**：v24.19.0（darwin-arm64 二进制）
- **许可证**：MIT（含若干第三方组件许可证，见 LICENSE 全文）
- **位置**：`dsh-runtime/node/`（本仓库 gitignore，构建/发布时下载；许可证文本随包分发于 `dsh-runtime/node/LICENSE`）
- **上游**：<https://nodejs.org> · 许可证原文：<https://raw.githubusercontent.com/nodejs/node/main/LICENSE>

### sharp / libvips

- **sharp**
  - **许可证**：Apache-2.0
  - **源码**：<https://github.com/lovell/sharp>
  - **说明**：经 dsh 间接引入（位于 `dsh-runtime/node_modules/sharp`），用于图像处理。
- **libvips**（sharp 的预编译二进制依赖，如 `@img/sharp-libvips-darwin-arm64`）
  - **许可证**：LGPL-3.0-or-later
  - **源码**：<https://github.com/libvips/libvips>
  - **声明**：libvips 以 LGPL-3.0 授权，以动态链接/独立二进制形式随 sharp 分发。依据 LGPL-3.0，用户可以替换该组件；其源码与许可证文本见上述仓库。本项目未修改 libvips 源码。

## 其余 npm 依赖概括

以下为对当前安装的 `node_modules`（根目录与 `dsh-runtime/`）按包名去重后的许可证统计（共约 774 个包，随依赖更新可能变化）：

| 许可证 | 包数（约） |
| --- | --- |
| MIT | 639 |
| Apache-2.0 | 75 |
| ISC | 31 |
| BSD-2-Clause / BSD-3-Clause | 21 |
| 其他（0BSD / CC0-1.0 / CC-BY-4.0 / Python-2.0 等） | 少量 |

> 重新生成方式（任选其一）：
>
> ```bash
> npx license-checker --json --production
> # 或直接扫描 node_modules 中各包的 package.json 的 license 字段
> ```

## Rust 依赖

`src-tauri/` 的 Rust 依赖（tauri、serde、tokio、reqwest 等，见 `src-tauri/Cargo.toml` 与 `Cargo.lock`）以 MIT / Apache-2.0 / BSD 系列许可证为主，许可证文本随 crates.io 各 crate 分发。

---

如认为本声明有遗漏或错误，欢迎提 Issue 指出。
