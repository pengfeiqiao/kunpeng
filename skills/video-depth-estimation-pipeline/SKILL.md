---
name: video-depth-estimation-pipeline
displayName: 视频转黑白深度
description: 将本地视频转换为近亮远暗的连续灰度深度视频，使用 Video Depth Anything 时序模型，保留时长和可选原声。用于深度控制视频、depth video、视频深度估计。
category: visual
visibility: library
triggers: 深度视频,黑白深度,深度图,深度估计,depth video,video depth
---

# 视频转黑白深度

使用本技能目录的 `scripts/convert.py`，不要临时拼逐帧模型、边缘检测、浮雕或伪彩方案。本流程使用官方 Video Depth Anything Small 相对深度模型，不是米制测距，也不是立体左右眼视频。

## 执行
1. 定位用户原片与当前深度 Python 环境，检查本机配置 `~/.kunpeng/video-depth.json` 的 repo；未配置时默认 `~/.kunpeng/runtimes/Video-Depth-Anything`。不要把旧聊天中的临时日期目录当通用安装位置。缺少环境时读取 `references/setup.md`。
2. 使用深度环境中的 Python 运行：
   `python <技能目录>/scripts/convert.py <原片路径> --output <新产物路径.mp4> --check`
3. 检查成功后移除 `--check` 执行同一命令。路径必须按当前 shell 正确引用。默认15fps、input-size=256、工作长边720、FP32、自动选择 CUDA/MPS/CPU，最终恢复源视频显示尺寸并保留第一条音轨。明确要求无声时加 `--silent`。8GB Mac 不要直接上518/全尺寸长片。
4. 通过 bash 的后台执行与 bash_read_output 跟进任务，检查 JSON stage 与进程退出码，不能因一次等待超时重复启动。同一输出存在 lock 表示已有任务；核实原进程后才能处理遗留锁。
5. 完成必须看到 `stage=completed`、MP4 和同名 `.depth.json` 回执。抽取开头、中段、结尾验证纯灰度、场景近远关系和明显闪烁，再交付可播放路径；不能只看文件存在就宣布完成。用户要求进入画布/剪辑时，沿用已有素材导入工具，不自动新建工作台。

## 固定约束
- 原视频不覆盖，已有输出不覆盖；失败不发布半成品。
- 变帧率输入先用 FFmpeg fps 滤镜按时间戳转为恒定帧率，不能按帧序号stride后伪装目标fps。核对视频流时长，不把音频尾长当视频时长。
- 默认近亮远暗的纯黑白连续灰度，不要 inferno/jet。全片共享稳健范围归一化（上界99.5百分位，极近端少量值会裁切），不能逐帧拉伸；模型异常/常量深度必须报错。
- 使用视频时序模型；降工作分辨率保留整个时间轴，不能截前几秒冒充完成。默认最多1800个工作帧，超过时说明资源限制并按需求降低fps或分段；分段需核验接缝，不承诺无闪烁。
- 720工作长边与256网络输入只是计算规格，输出恢复原尺寸不代表恢复了原生高分辨率深度细节。报告最终尺寸、fps、时长和计算规格。
- 无声输入正常支持；有声默认保留原声。不同长度音轨不通过 `-shortest` 截断深度画面。
- 下载源、代理、模型选择不静默更换。优先复用已装官方模型；本地转换不需要DMX/RunningHub key。
