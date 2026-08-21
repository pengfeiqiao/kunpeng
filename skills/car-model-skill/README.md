# Car Model Generation Skill

专业的汽车3D模型图片生成技能，使用Gemini API生成高质量汽车展示图片，并通过豆包AI进行质量分析和优化。

## 核心特性

- **多参考图融合**：支持最多6张参考图融合生成
- **智能提示词系统**：通用化提示词，适配任意车型
- **AI质量分析**：集成豆包视觉分析，自动检测生成问题
- **迭代优化流程**：支持人工干预的提示词优化循环
- **完整输出**：生成8张基础图 + 4张展示图

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置API密钥

复制 `config/config.example.json` 为 `config/config.json`，填入你的API密钥：

```json
{
  "gemini_api_key": "your-gemini-api-key",
  "doubao_api_key": "your-doubao-api-key",
  "base_url": "https://www.dmxapi.cn"
}
```

### 3. 生成车型模型

```python
from src.workflows.generate_car_model import CarModelGenerator

# 初始化生成器
generator = CarModelGenerator(
    brand="BMW",
    model="X3",
    reference_dir="path/to/reference/images",
    api_key="your-api-key"
)

# 执行生成
result = generator.generate_all()

# 检查结果
if result['status'] == 'success':
    print(f"生成成功！文件保存在: {result['output_dir']}")
else:
    # 使用豆包分析问题
    analyzer = result['analyzer']
    analysis = analyzer.analyze_issues()

    # 根据分析结果优化
    optimized = generator.optimize_with_analysis(analysis)
```

## 工作流程

### 标准流程

```
参考图 → Gemini生成 → 质量检查 → 通过 → 保存到数据库
                           ↓
                        不通过
                           ↓
                   豆包分析问题 → 优化提示词 → 重新生成
```

### 人工干预流程

当生成结果不符合要求时，可以启动人工干预流程：

```python
from src.workflows.optimize_with_doubao import DoubaoOptimizer

optimizer = DoubaoOptimizer(api_key="your-doubao-api-key")

# 对比分析
analysis = optimizer.compare_images(
    reference_image="reference.jpg",
    generated_image="generated.jpg",
    current_prompt="current prompt"
)

# 获取优化建议
print(analysis['issues'])           # 问题列表
print(analysis['optimized_prompt']) # 优化后的提示词

# 使用新提示词重新生成
generator.regenerate_with_prompt(
    category="body_rear",
    new_prompt=analysis['optimized_prompt']
)
```

## 目录结构

```
car-model-skill/
├── README.md                           # 本文档
├── skill.json                          # Skill元数据
├── requirements.txt                    # Python依赖
│
├── src/                                # 源代码
│   ├── core/                          # 核心模块
│   │   ├── gemini_client.py          # Gemini API客户端
│   │   ├── doubao_analyzer.py        # 豆包分析客户端
│   │   └── image_generator.py        # 图片生成器
│   ├── utils/                         # 工具模块
│   │   ├── showcase_creator.py       # Showcase生成
│   │   └── file_manager.py           # 文件管理
│   └── workflows/                     # 工作流
│       ├── generate_car_model.py     # 完整生成流程
│       └── optimize_with_doubao.py   # 豆包优化流程
│
├── config/                            # 配置
│   ├── prompts/                       # 提示词库
│   │   ├── body_views.json           # 车身视图提示词
│   │   ├── details.json              # 细节图提示词
│   │   └── showcase.json             # Showcase提示词
│   ├── config.example.json           # 配置示例
│   └── settings.json                 # 全局设置
│
├── templates/                         # 模板
│   └── metadata_template.json        # 元数据模板
│
├── car_database/                      # 数据库（持久化）
│   └── {Brand}/{Model}/              # 按品牌/车型组织
│       ├── images/                    # 基础图片
│       ├── showcase/                  # 展示图
│       └── metadata.json             # 元数据
│
├── output/                            # 临时输出（可清理）
│
└── examples/                          # 示例和文档
    ├── bmw_x3_case_study.md          # BMW X3案例研究
    └── workflow_diagram.md           # 流程图
```

## 提示词系统

提示词采用通用化设计，支持任意车型：

```json
{
  "body_front": "CRITICAL: The provided reference images show the REAL {brand} {model} production vehicle front view...",
  "body_side": "CRITICAL: The provided reference images show the REAL {brand} {model} production vehicle side view...",
  "body_rear": "# HIGHEST PRIORITY - SINGLE IMAGE OUTPUT\n仅输出单张完整的车身后视图..."
}
```

### 提示词原则

1. **通用化**：不包含具体品牌特征描述
2. **参数化**：使用 `{brand}`, `{model}` 占位符
3. **极简化**：遵循V3极简策略，避免具体数字和细节
4. **正向化**：优先使用正向指令而非否定式表达

## 豆包分析系统

### 分析维度

豆包分析器会从以下维度检测问题：

1. **构图问题**：多图拼接、角度不对、范围不符
2. **设计问题**：样式错误、元素缺失、多余元素
3. **细节问题**：标识、文字、logo等细节
4. **风格问题**：新旧款混淆、通用训练数据污染

### 使用示例

```python
from src.core.doubao_analyzer import DoubaoAnalyzer

analyzer = DoubaoAnalyzer(api_key="your-api-key")

# 单图分析
result = analyzer.analyze_single(
    reference_image="reference.jpg",
    generated_image="generated.jpg",
    prompt="current prompt",
    category="body_rear"
)

print(result['issues'])            # 问题列表
print(result['root_cause'])        # 根本原因
print(result['optimized_prompt'])  # 优化提示词
```

## 输出规范

### 基础图片（8张）

1. `body_front.jpg` - 车身前视图（16:9，白色摄影棚）
2. `body_side.jpg` - 车身侧视图（16:9，白色摄影棚）
3. `body_rear.jpg` - 车身后视图（16:9，白色摄影棚）
4. `wheel.jpg` - 轮毂特写（1:1）
5. `logo.jpg` - 车标配饰（1:1）
6. `sensor_radar.jpg` - 传感器雷达（1:1）
7. `lights_front.jpg` - 前灯组（1:1）
8. `lights_rear.jpg` - 后灯组（1:1）

### Showcase图片（4张）

1. `bannanapro_showcase.jpg` - 香蕉生图用（无限制）
2. `video_showcase_body.jpg` - 视频用-车身（长宽比≤3）
3. `video_showcase_lights.jpg` - 视频用-灯组（长宽比≤3）
4. `video_showcase_details.jpg` - 视频用-细节（长宽比≤3）

### Video Showcase约束

- 文件大小：≤ 4.7MB
- 分辨率：≤ 4096×4096
- 最短边：≥ 320px
- 长宽比：≤ 3:1

## 最佳实践

### 1. 参考图选择

- 选择清晰、高质量的官方图片
- 包含多个角度：前、后、侧、45度
- 包含细节特写：轮毂、logo、灯组
- 避免模糊、逆光、过度PS的图片

### 2. 提示词优化

当生成结果不理想时：

1. 使用豆包分析器对比参考图和生成图
2. 识别问题根源（不是简单的"优化"）
3. 针对性修改提示词
4. 使用迭代方式，逐步改进

### 3. 人工干预时机

遇到以下情况需要人工干预：

- 连续3次生成失败
- 豆包分析发现严重问题（构图错误、样式完全不符）
- 细节错误（标识、logo等）

## 故障排除

### Q: 生成的图片使用了旧款设计？

A: 提示词需要明确禁止调用通用训练数据：

```python
prompt = """
完全禁止调用模型自身的{brand} {model}通用训练数据
所有设计元素100%对齐参考图
"""
```

### Q: 生成的图片变形了？

A: 在提示词中强调单张输出和原始比例：

```python
prompt = """
仅输出单张图像
保持原始比例，不要变形
"""
```

### Q: 生成了多张拼接图？

A: 明确禁止多图拼接：

```python
prompt = """
绝对禁止任何多图拼接、多视角组合、拼贴形式
必须是一张完整的图像
"""
```

## 技术细节

### Gemini API使用

```python
from src.core.gemini_client import GeminiClient

client = GeminiClient(api_key="your-api-key")

# 多参考图生成
image_data = client.generate_with_references(
    reference_images=["ref1.jpg", "ref2.jpg", "ref3.jpg"],
    prompt="your prompt",
    aspect_ratio="16:9",
    image_size="2K"
)
```

### 豆包API使用

```python
from src.core.doubao_analyzer import DoubaoAnalyzer

analyzer = DoubaoAnalyzer(api_key="your-api-key")

# 图片对比分析
result = analyzer.compare_images(
    reference="reference.jpg",
    generated="generated.jpg",
    prompt="current prompt"
)
```

## 案例研究

参见 `examples/bmw_x3_case_study.md` 了解完整的BMW X3生成案例，包括：

- 多次迭代优化过程
- 豆包分析的实际应用
- 提示词演进历程
- 最终解决方案

## 更新日志

### v3.0.0 (2026-02-22)

- 重构为标准化skill结构
- 集成豆包AI质量分析
- 优化提示词系统，实现通用化
- 新增人工干预流程
- 完善文档和示例

## 贡献指南

欢迎提交Issue和Pull Request来改进这个skill！

## 许可证

MIT License
