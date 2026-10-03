# 环境准备

先复用已有环境与权重，不重复下载。用对应解释器运行 convert.py --check，不要假定系统Python已经有torch。

官方来源：
- https://github.com/DepthAnything/Video-Depth-Anything
- https://huggingface.co/depth-anything/Video-Depth-Anything-Small
- 权重文件 video_depth_anything_vits.pth，放在仓库 checkpoints 中；这是 Video 模型，不是 Depth-Anything-V2-Small-hf。

新环境建议 Python 3.11/3.12，独立 venv。以当前系统语法创建 ~/.kunpeng/venv-video-depth；macOS/Linux解释器位于 bin/python，Windows位于 Scripts/python.exe。通过该解释器的 `-m pip install torch torchvision numpy opencv-python imageio imageio-ffmpeg einops easydict matplotlib tqdm` 安装推理依赖。CUDA环境按照PyTorch官方匹配驱动的说明安装；不把Mac环境锁定为Windows配置。

将官方仓库克隆到 ~/.kunpeng/runtimes/Video-Depth-Anything。无需修改上游 run.py 或 matplotlib：转换脚本直接加载模型，自行选择设备与写灰度视频。decord/xformers/OpenEXR 对此流程不是必需项；未安装xformers的警告不等于失败。

安装 FFmpeg（需同时提供 ffmpeg、ffprobe）并加入运行环境 PATH。Python依赖安装与模型下载失败时报告实际错误，勿擅自清除用户全局代理或切换镜像。下载到临时文件，完成后才改为最终权重名；官方模型加载使用 weights_only=True。

已有其他安装位置可以传 --repo/--checkpoint，或把本机 repo 路径存入 ~/.kunpeng/video-depth.json，例如 {"repo":"本机官方仓库绝对路径"}。只保存在本机配置，不把用户名、旧项目日期路径提交为公共默认值。

运行回执记录工作分辨率、网络输入、时长、fps及音轨状态。具体耗时取决于硬件，不套用A100吞吐承诺。长片离线模型会保留整段帧/深度；降低fps或明确分段，不启用无上限内存配置。
