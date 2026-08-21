"""
对话引导提示词
====================================================
定义各步骤的引导提示词模板。

用法：
    from systems.conversation import ConversationPrompts

    prompt = ConversationPrompts.get_prompt("welcome")
"""

from typing import Dict, List, Optional
from dataclasses import dataclass


@dataclass
class PromptTemplate:
    """提示词模板"""
    key: str
    template: str
    variables: List[str]


class ConversationPrompts:
    """对话引导提示词"""

    # ============================================================
    # 项目初始化阶段
    # ============================================================

    WELCOME = """
太好了！我来帮你创建一个视频风格复刻项目。

这个工具可以帮你把喜欢的影视剧风格复刻到新的场景和角色上，生成分镜图。

让我们开始吧！请问你想复刻哪种风格？
"""

    STYLE_OPTIONS = """
目前支持的风格：

1. **古装剧风格**（知否/清平乐风格）- 宋代古装剧质感
2. **未来废土风格**（赛博朋克）- 末世废土质感
3. **现代旅游风光影视片** - 16:9标准宽屏，自然光影诗意，支持真人参考图

请告诉我你的选择（输入数字或风格名称）：
"""

    STYLE_SELECTED = """
好的，选择了「{style_name}」风格！

{style_description}

现在请给你的项目起个名字，方便以后查找：
"""

    PROJECT_NAME_CONFIRM = """
项目名称：**{name}**

请选择项目保存位置：
- 默认位置：桌面（{default_location}）
- 或者告诉我其他位置
"""

    PROJECT_LOCATION_CONFIRM = """
让我确认一下项目信息：

📁 **项目名称**：{name}
🎨 **视觉风格**：{style}
📂 **保存位置**：{location}

确认创建这个项目吗？（确认/修改）
"""

    PROJECT_CREATED = """
✅ **项目创建成功！**

📁 位置：{location}
📄 配置文件：project.yaml
📝 工作日志：work_log.md

接下来我们开始创建角色卡。
"""

    # ============================================================
    # 角色创建阶段
    # ============================================================

    START_CHARACTER = """
接下来我们来创建角色卡。请问你的故事里有几个主要角色？

（通常是一个男主和一个女主，你也可以创建更多）
"""

    CHARACTER_COUNT_CONFIRM = """
好的，我们要创建 **{count}** 个角色。

让我们从第一个角色开始。这个角色是：
1. **男主**
2. **女主**
3. **配角**

请告诉我：
"""

    CHARACTER_TYPE_TEMPLATE = """
好的，我们来定义{character_type}的信息。

请告诉我以下信息：

1. **角色名称**：给他/她起个名字
2. **角色原型**：{archetype_examples}
3. **年龄范围**：如 20-25 岁
4. **性格特点**：如 清冷、孤傲、隐忍
5. **外貌特征**：有什么特殊的标记吗？（比如痣、疤痕、特殊的发型等）

你可以用自然语言描述，我会帮你整理。
"""

    CHARACTER_INFO_CONFIRM = """
让我确认一下{character_type}的信息：

👤 **角色名称**：{name}
🎭 **角色原型**：{archetype}
🎂 **年龄范围**：{age_range}
💫 **性格特点**：{temperament}
👀 **外貌特征**：{appearance}
✨ **特殊标记**：{special_marks}

确认无误吗？（确认/修改）
"""

    CHARACTER_CONFIRMED = """
✅ **角色「{name}」已确认！**

现在我们开始生成定妆照。我会使用 AI 生成几张候选图，然后你选择最喜欢的一张。

预计生成 4 张候选图，请稍等...
"""

    MAKEUP_GENERATED = """
定妆照已生成！这是 {count} 张候选图：

{image_list}

请选择你最喜欢的一张作为最终定妆照（输入 U1-U4）。
"""

    MAKEUP_SELECTED = """
✅ 已选择 **{selection}** 作为定妆照！

接下来我们生成三视图（正面、侧面、背面），用于后续分镜生成。

请稍等...
"""

    THREEVIEW_GENERATED = """
✅ **三视图已生成！**

现在角色「{name}」的资料已经完整了：
- 定妆照：已确认
- 三视图：已生成

{next_character_prompt}
"""

    NEXT_CHARACTER_PROMPT = """
接下来我们创建第 {index}/{total} 个角色。

这个角色是：
1. **男主**
2. **女主**
3. **配角**

请告诉我：
"""

    ALL_CHARACTERS_DONE = """
🎉 **所有角色创建完成！**

已创建的角色：
{character_list}

接下来我们进入场景创建阶段。
"""

    # ============================================================
    # 场景创建阶段
    # ============================================================

    START_SCENE = """
现在我们来创建场景。

请问你的分镜需要几个场景？
"""

    SCENE_INFO_TEMPLATE = """
好的，我们来定义第 {index}/{total} 个场景。

请告诉我：
1. **场景名称**：如 "陶记糕团铺初遇"
2. **场景描述**：这个场景是什么样的？
3. **场景类型**：
   - 室内白天
   - 室内夜晚
   - 室外白天
   - 室外夜晚
4. **出场角色**：这个场景有哪些角色？
"""

    SCENE_INFO_CONFIRM = """
让我确认一下场景信息：

🎬 **场景名称**：{name}
📝 **场景描述**：{description}
🌤️ **场景类型**：{scene_type}
👥 **出场角色**：{characters}

确认无误吗？（确认/修改）
"""

    SCENE_CONFIRMED = """
✅ **场景「{name}」已确认！**

{next_scene_prompt}
"""

    NEXT_SCENE_PROMPT = """
接下来我们创建第 {index}/{total} 个场景。
"""

    ALL_SCENES_DONE = """
🎉 **所有场景创建完成！**

已创建的场景：
{scene_list}

接下来我们进入分镜生成阶段。
"""

    # ============================================================
    # 场景图放大阶段
    # ============================================================

    SCENE_CONCEPT_GENERATED = """
✅ **场景概念图已生成！**

{scene_name}

现在你可以选择对场景图进行放大（裁剪局部区域），或者直接进入分镜生成阶段。
"""

    SCENE_UPSAMPLE_PROMPT = """
你想对场景图进行放大吗？

1. **放大（裁剪）** - 选择场景图的局部区域进行裁剪放大
2. **跳过** - 直接使用当前场景图进入分镜生成

请选择：
"""

    SCENE_UPSAMPLE_REGION_PROMPT = """
请描述你想放大的区域，例如：
- "中心区域" - 自动裁剪中心 80% 区域
- "左上角" - 裁剪左上角区域
- "右边人物" - 裁剪右边人物区域

或者直接说「默认」使用中心区域裁剪：
"""

    SCENE_UPSAMPLE_DONE = """
✅ **场景图放大完成！**

放大后的图片已保存：{output_path}

接下来我们进入分镜生成阶段。
"""

    # ============================================================
    # 分镜生成阶段
    # ============================================================

    START_STORYBOARD = """
现在我们开始生成分镜图。

首先我会合成一张全景分镜（包含 9 个分镜的全景图）。

请确认以下信息：
- 场景：{scene_name}
- 角色：{characters}
- 风格：{style}

确认开始生成吗？
"""

    STORYBOARD_WIDE_GENERATED = """
✅ **全景分镜已生成！**

{next_step_prompt}
"""

    STORYBOARD_GRID_PROMPT = """
接下来我可以选择：
1. **生成九宫格**：将全景图分割成 9 张独立分镜
2. **直接生成独立分镜**：逐张生成 9 张分镜图

你想要哪种方式？
"""

    STORYBOARD_SHOTS_GENERATED = """
✅ **分镜生成完成！**

已生成的分镜图：
{shot_list}

接下来我们进入最终审查阶段。
"""

    # ============================================================
    # 审查与优化阶段
    # ============================================================

    START_REVIEW = """
现在我们来审查生成的分镜。

你可以：
1. **查看所有分镜** - 我会逐张展示
2. **直接确认** - 如果满意，可以直接完成
3. **重新生成** - 如果不满意，可以重新生成某些分镜

请告诉我你的选择：
"""

    REVIEW_SHOT = """
这是第 {index}/{total} 张分镜：

{image_path}

满意吗？（满意/重新生成/跳过）
"""

    ALL_REVIEWED = """
🎉 **所有分镜已审查完成！**

{summary}

项目已完成！所有文件保存在：
📁 {project_path}

你还想做什么？
1. **查看项目摘要**
2. **继续优化**
3. **开始新项目**
4. **退出**
"""

    # ============================================================
    # 视频提示词生成阶段
    # ============================================================

    START_VIDEO_PROMPT = """
分镜审查完成！接下来你可以选择生成 **视频提示词**。

视频提示词是用于 AI 视频生成平台的提示文本，会将 9 个分镜按 2-2-2-2-1 的顺序分为 5 段视频（约 15-19 秒）。

你想生成视频提示词吗？
1. **生成视频提示词** - 我会为这个场景生成 5 段提示词
2. **跳过** - 稍后再生成
"""

    VIDEO_PROMPT_GENERATING = """
正在生成视频提示词...

我会根据以下信息生成 5 段视频提示词：
- 场景：{scene_name}
- 角色：{characters}
- 分镜：9 个分镜

预计生成时间：10-20 秒
"""

    VIDEO_PROMPT_GENERATED = """
✅ **视频提示词生成完成！**

已生成 5 段视频提示词：
- 段落1（开篇）：分镜 1+2，约 4 秒
- 段落2（发展）：分镜 3+4，约 4 秒
- 段落3（高潮）：分镜 5+6，约 4 秒
- 段落4（转折）：分镜 7+8，约 4 秒
- 段落5（结尾）：分镜 9，约 3 秒

📁 保存位置：{output_path}

你可以：
1. **查看提示词** - 展示生成的提示词内容
2. **继续** - 完成项目
"""

    VIDEO_PROMPT_SHOW = """
## 段落{segment_index}：{segment_name}

**分镜**: {shots_included}
**预估时长**: {duration}秒

{prompt_text}
"""

    # ============================================================
    # 通用提示
    # ============================================================

    CONFIRM_YES_NO = """
请确认：
{message}

（确认/取消）
"""

    ERROR_OCCURRED = """
❌ 发生错误：{error}

请告诉我你想怎么做：
1. **重试** - 再试一次
2. **跳过** - 跳过这一步
3. **返回** - 返回上一步
"""

    UNKNOWN_INTENT = """
抱歉，我不太理解你的意思。

你可以说：
- "我想做一个古装剧的分镜"
- "创建一个新项目"
- "继续之前的项目"
- "查看我的项目"

请问你想做什么？
"""

    PROJECT_LIST = """
📋 **你的项目列表**：

{project_list}

请告诉我你想打开哪个项目（输入项目名称或编号）。
"""

    CONTINUE_PROJECT = """
好的，让我们继续「{project_name}」项目。

当前状态：
- 阶段：{phase}
- 进度：{progress}

你想：
1. **继续上次的步骤**
2. **从头开始**
3. **查看项目详情**
"""

    @classmethod
    def get_prompt(cls, key: str, **kwargs) -> str:
        """
        获取提示词

        Args:
            key: 提示词键名
            **kwargs: 模板变量

        Returns:
            格式化后的提示词
        """
        template = getattr(cls, key, None)
        if template is None:
            return f"[未知提示词: {key}]"

        try:
            return template.format(**kwargs)
        except KeyError as e:
            return template

    @classmethod
    def format_character_type(cls, character_type: str) -> str:
        """格式化角色类型"""
        type_map = {
            "male_lead": "男主",
            "female_lead": "女主",
            "supporting": "配角"
        }
        return type_map.get(character_type, character_type)

    @classmethod
    def get_archetype_examples(cls, character_type: str, style: str = "costume_drama") -> str:
        """获取角色原型示例"""
        examples = {
            "costume_drama": {
                "male_lead": "落魄世家公子、书生、将军、皇子、商人",
                "female_lead": "官宦小姐、商人女儿、医女、宫女、侠女",
                "supporting": "管家、丫鬟、侍卫、官员、邻居"
            },
            "wasteland": {
                "male_lead": "废土拾荒者、技术幸存者、雇佣兵、部落首领",
                "female_lead": "机械师、医生、反抗军战士、游商",
                "supporting": "老人、孩子、机器人、商人、敌人"
            }
        }
        return examples.get(style, {}).get(character_type, "各种类型")
