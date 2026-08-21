"""
表演系统 V2 — 情绪+动作模板库
====================================================
支持多种情绪状态和动作描述，解决原有系统针对单一情境硬编码的问题。

情绪模板：
    - distressed: 痛苦/濒死状态（Scene 01 男主适用）
    - caring: 关切/怜悯（Scene 01 女主适用）
    - focused_calm: 专注平静（Scene 02 男主适用）
    - confident_skilled: 自信熟练（Scene 02 女主适用）
    - curious: 好奇/探询
    - joyful: 愉悦/开心
    - angry: 愤怒/激动
    - fearful: 恐惧/惊恐

动作描述：
    - sitting_collapsed: 瘫坐（Scene 01 男主）
    - offering_food: 递食物（Scene 01 女主）
    - writing_brush: 写毛笔字（Scene 02 男主）
    - kneading_dough: 揉面（Scene 02 女主）
    - walking: 行走
    - standing: 站立
    - reading: 阅读

用法：
    from systems.performance_system_v2 import get_performance_prompt
    prompt = get_performance_prompt("wide", emotion="focused_calm", action="writing_brush", character="male")
"""

from enum import Enum
from typing import Optional


class EmotionType(Enum):
    """情绪类型枚举"""
    DISTRESSED = "distressed"              # 痛苦/濒死
    CARING = "caring"                      # 关切/怜悯
    FOCUSED_CALM = "focused_calm"          # 专注平静
    CONFIDENT_SKILLED = "confident_skilled"  # 自信熟练
    CURIOUS = "curious"                    # 好奇
    JOYFUL = "joyful"                      # 愉悦
    ANGRY = "angry"                        # 愤怒
    FEARFUL = "fearful"                    # 恐惧
    NEUTRAL = "neutral"                    # 中性/平静


class ActionType(Enum):
    """动作类型枚举"""
    SITTING_COLLAPSED = "sitting_collapsed"  # 瘫坐
    OFFERING_FOOD = "offering_food"          # 递食物
    WRITING_BRUSH = "writing_brush"          # 写毛笔字
    KNEADING_DOUGH = "kneading_dough"        # 揉面
    WALKING = "walking"                      # 行走
    STANDING = "standing"                    # 站立
    READING = "reading"                      # 阅读
    COOKING = "cooking"                      # 烹饪
    SERVING = "serving"                      # 端菜/上菜


class CharacterType(Enum):
    """角色类型"""
    MALE = "male"
    FEMALE = "female"


# ── 情绪模板库 ────────────────────────────────────────────────

EMOTION_TEMPLATES = {
    # 专注平静（Scene 02 男主适用）
    EmotionType.FOCUSED_CALM: {
        "micro_expressions": """MICRO-EXPRESSIONS (focused calm state):
- Upper face: brows slightly furrowed in natural concentration, NOT stress or anger
  Eyelids relaxed, normal opening, clear alert gaze
  No brow tension, no worry lines
- Lower face: lips naturally closed with slight compression, NOT tight or tense
  Jaw relaxed, teeth not clenched
  Mouth corners neutral, neither smiling nor frowning
- Physiological: normal healthy skin tone, no distress markers
  No dark circles, no pallor, natural complexion""",

        "eye_system": """EYE SYSTEM (focused calm):
- Focus point: clearly on the task (paper/brush/work), sharp attention
- Pupils: normal dilation for indoor lighting, not dilated or constricted
- Gaze direction: downward at work surface, approximately 30-45 degree angle
- Catch lights: consistent with room lighting, single natural catch light
- Expression: quiet concentration, absorbed in task, NOT blank or vacant""",

        "body_language_base": """BODY LANGUAGE BASE (focused calm):
- Posture: upright but relaxed spine, natural curve, NOT rigid military posture
- Weight distribution: even and stable, grounded but not tense
- Shoulders: relaxed and dropped, NOT hunched or raised
- Breathing: natural, subtle movement, no tension holding
- Overall: engaged presence, quiet alertness, productive stillness"""
    },

    # 自信熟练（Scene 02 女主适用）
    EmotionType.CONFIDENT_SKILLED: {
        "micro_expressions": """MICRO-EXPRESSIONS (confident skilled state):
- Upper face: brows relaxed in natural position, slight arch suggesting confidence
  Eyes bright and alert, engaged with the task
  No furrow or tension, open and present expression
- Lower face: slight smile at mouth corners (1-2mm lift), genuine micro-smile
  NOT a forced smile or grin, natural pleasantness from enjoyment of work
  Lips may be slightly parted during physical exertion
- Physiological: healthy complexion, slight warmth from physical activity
  Natural skin glow from work, NOT oily or sweaty""",

        "eye_system": """EYE SYSTEM (confident skilled):
- Focus point: on the task with ease, experienced worker's gaze
- Pupils: normal, responsive to light
- Gaze direction: shifts naturally between hands and materials
- Expression: confident, practiced, in-flow state
- Connection: grounded in the present activity, muscle memory at work""",

        "body_language_base": """BODY LANGUAGE BASE (confident skilled):
- Posture: confident stance, weight centered and stable
- Movement: fluid, practiced motions of someone who has done this thousands of times
- Shoulders: relaxed, efficient movement pattern
- Core: engaged for stability during physical work
- Overall: mastery and ease, no hesitation or uncertainty"""
    },

    # 痛苦/濒死（Scene 01 男主适用）
    EmotionType.DISTRESSED: {
        "micro_expressions": """MICRO-EXPRESSIONS (distressed/near-collapse state):
- Upper face: no brow tension, brow muscles completely relaxed and sagging
  Eyelids heavy with ptosis (half-closed, pupils 70% covered by upper lids)
  No eye crease activation, eye corners slightly red with visible bloodshot
- Lower face: jaw slightly slack and dropped, lips dry with faint chapping
  Corners of mouth naturally drooping 2-3 degrees, zero muscle tension in cheeks
  Cheekbones flushed from cold (pale pink discoloration)
- Physiological details: faint dark circles under eyes, skin pale and drawn
  Lip color dusky, 0.5mm vertical glabellar lines from hunger discomfort""",

        "eye_system": """EYE SYSTEM (distressed):
- Focus: completely unfocused and glazed, directed vaguely toward warm light
  NOT fixing on any specific object or person
- Pupils: slightly dilated, 60% eye-white visible
- Gaze direction: downward 20 degrees, toward own hands area
- Relationship: ZERO awareness of others, no response, no eye contact""",

        "body_language_base": """BODY LANGUAGE BASE (distressed):
- Gravity: entire weight collapsed, passive body mass
- Muscle state: passive frozen stiffness (not active tension)
  Limbs heavy and unresponsive, hunched shoulders drawn toward ears
- Time anchor: has been immobile for a long time — visible signs of prolonged stillness
- Overall: body in survival mode, minimal energy expenditure"""
    },

    # 关切/怜悯（Scene 01 女主适用）
    EmotionType.CARING: {
        "micro_expressions": """MICRO-EXPRESSIONS (caring/concern state):
- Upper face: inner eyebrows subtly raised and drawn together (empathy signal)
  Slight tension in lower eyelids forming faint under-eye creases
  Eye tails pressed down 15 degrees, NO raised outer brows (no fear/shock)
- Lower face: lips softly pressed, NOT smiling, NOT curved upward
  Apple muscles lifted less than 0.5cm, mouth corners lifted 3 degrees maximum
  Zero teeth showing, natural expression of quiet concern
- Physiological: natural skin, no heavy makeup flush
  Head tilted 10 degrees to the left, eyebrows in compassion position""",

        "eye_system": """EYE SYSTEM (caring):
- Focus: 100% locked on subject, soft empathetic focus
- Pupils: slightly dilated (witnessing someone in need)
- Gaze direction: downward, appropriate distance to subject
- Relationship: PITY and QUIET CURIOSITY only — zero romantic/loving quality
  Zero aggression, zero ambiguity""",

        "body_language_base": """BODY LANGUAGE BASE (caring):
- Gravity: weight shifted forward, engaged stance
- Muscle state: waist and core slightly engaged, gentle tension of readiness
- Movement: slow, cautious, non-threatening approach
- Overall: protective but respectful, maintaining appropriate distance"""
    },

    # 好奇（保留扩展）
    EmotionType.CURIOUS: {
        "micro_expressions": """MICRO-EXPRESSIONS (curious state):
- Upper face: eyebrows slightly raised, forehead slightly creased in interest
  Eyes widened slightly, bright and alert
- Lower face: lips slightly parted, head tilted
  Natural expression of inquiry
- Physiological: alert posture, engaged presence""",

        "eye_system": """EYE SYSTEM (curious):
- Focus: locked on object of interest, scanning for information
- Pupils: slightly dilated in interest
- Gaze: direct but not aggressive
- Expression: open, seeking, questioning""",

        "body_language_base": """BODY LANGUAGE BASE (curious):
- Posture: leaning slightly forward, engaged
- Head: tilted, listening/watching position
- Overall: open and receptive, gathering information"""
    },

    # 愉悦/开心（Scene 02 女主适用）
    EmotionType.JOYFUL: {
        "micro_expressions": """MICRO-EXPRESSIONS (joyful state):
- Upper face: brows slightly raised in genuine happiness, NOT frozen
  Eyes crinkle naturally at corners (Duchenne marker), bright and lively
- Lower face: genuine smile with visible teeth or closed-lip smile
  Cheeks raised, nasolabial folds visible (smile lines)
  For female lead: dimples clearly visible when smiling
- Physiological: relaxed jaw, no tension in face""",

        "eye_system": """EYE SYSTEM (joyful):
- Focus: bright, engaged, sparkling with amusement
- Pupils: slightly dilated in genuine enjoyment
- Gaze: may be directed at object of amusement or person
- Expression: warmth, genuine happiness, NOT forced smile""",

        "body_language_base": """BODY LANGUAGE BASE (joyful):
- Posture: relaxed, open, may have slight bounce or energy
- Shoulders: dropped and relaxed, not hunched
- Head: may tilt slightly when amused
- Overall: natural ease, genuine enjoyment of moment"""
    },

    # 中性/平静（保留扩展）
    EmotionType.NEUTRAL: {
        "micro_expressions": """MICRO-EXPRESSIONS (neutral/calm state):
- Upper face: brows in natural position, no tension
  Eyes at normal opening, neutral gaze
- Lower face: lips naturally closed, neutral expression
  No smile, no frown, resting face
- Physiological: normal, no strong emotion markers""",

        "eye_system": """EYE SYSTEM (neutral):
- Focus: soft, not locked on anything specific
- Pupils: normal
- Gaze: relaxed, may drift
- Expression: calm, present but not engaged""",

        "body_language_base": """BODY LANGUAGE BASE (neutral):
- Posture: relaxed, natural standing/sitting
- No tension or anticipation
- Overall: at rest, not actively engaging"""
    }
}


# ── 动作描述库 ─────────────────────────────────────────────────

ACTION_DESCRIPTIONS = {
    # 写毛笔字（Scene 02 男主）
    ActionType.WRITING_BRUSH: {
        "description": """ACTION: WRITING WITH BRUSH (Traditional Chinese Calligraphy)

HAND AND GRIP:
- Grip: traditional five-finger brush hold (悬腕法 - suspended wrist method)
  Thumb: presses brush handle from left side
  Index finger: guides from right side
  Middle, ring, pinky fingers: support from below, creating stable triangle
- Wrist: SUSPENDED above paper surface, NOT resting on table
  This is critical — traditional brush writing requires elevated wrist
  Wrist may have 2-3cm clearance from paper

ARM AND BODY:
- Arm: elbow slightly elevated, movement comes from shoulder
  NOT just finger movement — whole arm participates in strokes
- Shoulder: relaxed but engaged, controlled movement
- Posture: sitting upright at desk, paper at comfortable distance
- Head: tilted slightly down toward work, focused

MOVEMENT:
- Strokes: deliberate, controlled movements
  Each stroke has clear beginning, middle, and end
- Speed: moderate, not rushed, mindful pace
- Rhythm: natural breathing rhythm with brush strokes""",

        "weight_distribution": """WEIGHT: seated on chair/stool, weight even on sitting bones
Stability from core engagement, NOT rigid tension""",

        "props": """PROPS:
- Brush: held in dominant hand, angle approximately 45-60 degrees to paper
- Paper: on desk/table, may have paperweight or be held by non-dominant hand
- Ink: in inkstone nearby, brush periodically re-inked"""
    },

    # 揉面（Scene 02 女主）
    ActionType.KNEADING_DOUGH: {
        "description": """ACTION: KNEADING DOUGH (Making Traditional Dough)

HAND AND ARM:
- Hands: palms pressing into dough, fingers spread for leverage
  Heel of palm does most of the pressing work
  Fingers help fold and turn the dough
- Arms: shoulders relaxed, elbows slightly bent
  Rhythmic pushing and folding motion
  Movement comes from shoulders and upper arms, not just forearms

BODY MECHANICS:
- Weight: shifts subtly with each push, natural counterbalance
- Core: engaged for stability during repetitive motion
- Stance: stable standing or seated position, close to work surface
- Rhythm: steady, practiced tempo of someone who has done this many times

SKILLED WORKER MARKERS:
- Dough handling: confident, no hesitation
- Pressure: consistent, knowing exactly how much force to apply
- Flour: dusted on hands and surface, shows evidence of ongoing work
  NOT perfectly clean hands — real dough work is messy
- Surface: wooden board or table with flour scattered

FLOUR AND MESS (authenticity markers):
- Hands: flour on palms, between fingers, slightly caked
- Arms: may have flour streaks up forearms
- Apron/clothes: flour dust, evidence of active work
- Work surface: scattered flour, not pristine
- This is REAL work, not a posed photo"""

    ,

        "weight_distribution": """WEIGHT: standing or seated, weight centered
Natural sway with kneading rhythm""",

        "props": """PROPS:
- Dough: on wooden board or table, size appropriate for hand work
- Flour: dusted on surface and hands
- Bowl: nearby for additional flour or water"""
    },

    # 瘫坐（Scene 01 男主）
    ActionType.SITTING_COLLAPSED: {
        "description": """ACTION: COLLAPSED SITTING (Near-Exhaustion State)

BODY POSITION:
- Gravity: entire weight collapsed onto hip and supporting arm
  Spine curved at 120 degrees, completely passive body mass
- Muscle state: passive frozen stiffness in neck and shoulders
  NOT active tension — body has given up holding posture
  Limbs heavy and unresponsive, hunched shoulders drawn toward ears
- Time anchor: has been immobile for a long time
  2mm snow accumulated on shoulder and hair WITHOUT sliding off
  Frost visible on collar and clothing edges

HANDS AND ARMS:
- Supporting arm: elbow on ground/knee, minimal muscle engagement
  Arm is prop, not active support
- Other hand: loosely holding prop (frozen bun) resting on knee
  Grip limp, not gripping intentionally
  Object could fall from hand without resistance""",

        "weight_distribution": """WEIGHT: completely passive, gravity-determined
Body has given up maintaining posture, slumped position""",

        "props": """PROPS:
- May hold object loosely: frozen bun, bowl, etc.
- Grip: minimal, object barely secured"""
    },

    # 递食物（Scene 01 女主）
    ActionType.OFFERING_FOOD: {
        "description": """ACTION: OFFERING FOOD (Cautious Approach)

BODY POSITION:
- Gravity: weight shifted entirely onto front foot
  Upper body angled forward 45 degrees
  Center of gravity forward but stable
- Muscle state: waist and core slightly engaged to maintain lean balance
  Right arm extended GENTLY — wrist relaxed, fingers naturally cupped under food
  Left hand resting on door frame for support
  Knees slightly bent for balance

TIMING:
- Action PAUSED at moment of offering
  Extended arm has not yet made contact with recipient
  0.5 seconds before touch
- Movement: gentle, non-threatening, cautious approach""",

        "weight_distribution": """WEIGHT: forward-leaning, front foot dominant
Ready to retreat if needed""",

        "props": """PROPS:
- Food item (roasted yam, bun, etc.): held in extended hand
  Fingers cupped underneath, supporting from below
  NOT gripping or pinching the food"""
    },

    # 行走（保留扩展）
    ActionType.WALKING: {
        "description": """ACTION: WALKING

GAIT:
- Natural walking stride, weight transferring heel-to-toe
- Arms swinging naturally in counterbalance
- Gaze: forward or at destination, not at feet
- Pace: appropriate for context (hurried, casual, etc.)""",

        "weight_distribution": """WEIGHT: dynamic, shifting between feet
Natural walking rhythm""",

        "props": """PROPS: depends on context
May carry items, hold clothing, etc."""
    },

    # 站立（保留扩展）
    ActionType.STANDING: {
        "description": """ACTION: STANDING

POSTURE:
- Weight: even on both feet or shifted to one hip
- Spine: natural curves, not rigid
- Arms: at sides or in natural position
- Gaze: appropriate for context""",

        "weight_distribution": """WEIGHT: stable, grounded
May shift slightly""",

        "props": """PROPS: depends on context"""
    },

    # 烹饪（保留扩展）
    ActionType.COOKING: {
        "description": """ACTION: COOKING

BODY:
- Active engagement with cooking process
- Hands: handling ingredients, utensils
- Movement: purposeful, task-oriented
- May involve stirring, chopping, etc.

AUTHENTICITY:
- Visible signs of cooking: steam, ingredients out
- Not perfectly clean — real cooking is messy""",

        "weight_distribution": """WEIGHT: centered, stable for work
May shift during different tasks""",

        "props": """PROPS:
- Cooking utensils: wok, ladle, chopsticks
- Ingredients: vegetables, meat, seasonings
- Heat source: stove, fire, etc."""
    },

    # 端菜/上菜（保留扩展）
    ActionType.SERVING: {
        "description": """ACTION: SERVING FOOD

BODY:
- Carrying tray or dishes
- Careful, balanced movement
- Arms: supporting the tray/dishes
- Gaze: may check on items being carried

AUTHENTICITY:
- Natural carrying posture
- Weight adjusted for load""",

        "weight_distribution": """WEIGHT: adjusted for carried items
Slight counterbalance""",

        "props": """PROPS:
- Tray, dishes, bowls
- Food items being served"""
    }
}


# ── 反模式约束 ─────────────────────────────────────────────────

PERFORMANCE_ANTI_PATTERNS = """
=== PERFORMANCE ANTI-PATTERNS (Critical Quality Control) ===

1. NO AI TYPICAL "FAKE SMILE"
   - Avoid: raised cheeks, curved mouth, visible teeth when not appropriate
   - Real expression: subtle, context-appropriate, micro-movements only

2. NO STIFF "STOCK PHOTO" POSES
   - Avoid: symmetrical postures, hands in perfect positions
   - Real pose: natural asymmetry, slight imperfections, lived-in quality

3. NO ANATOMICAL ERRORS
   - Hand proportions: correct finger joint lengths, natural hand shape
   - Body proportions: correct limb lengths, natural joint positions
   - NO rubber fingers, NO impossible joint angles

4. NO VACANT STARES
   - Eyes must have clear focus point
   - Pupils should respond to light direction
   - Catch lights consistent with scene lighting

5. NO FLOATING/GRAVITY ISSUES
   - Weight must be clearly grounded
   - Contact points with surfaces must show pressure
   - Shadows must support the sense of grounding

6. NO OVERLY CLEAN/PERFECT APPEARANCE
   - Working characters should show signs of work
   - Clothes may have wrinkles, dust, wear
   - Hands may be dirty, flour-covered, etc.

7. NO MODERN BODY LANGUAGE
   - Period-appropriate posture and movement
   - Traditional ways of sitting, standing, working
   - No modern casual poses in period pieces
"""


# ── 景别权重规则 ───────────────────────────────────────────────

def _get_weighted_content(
    emotion_template: dict,
    action_description: dict,
    shot_type: str,
    include_action: bool = True
) -> tuple:
    """
    根据景别返回加权后的内容。

    权重规则：
        closeup  → 微表情100% + 眼神100% + 身体语言10%（仅关键细节）
        medium   → 微表情70%  + 眼神70%  + 身体语言50%
        wide     → 微表情20%  + 眼神20%  + 身体语言80%
    """
    micro = emotion_template.get("micro_expressions", "")
    eyes = emotion_template.get("eye_system", "")
    body_base = emotion_template.get("body_language_base", "")

    action_desc = action_description.get("description", "") if include_action else ""
    action_weight = action_description.get("weight_distribution", "")
    action_props = action_description.get("props", "")

    if shot_type == "closeup":
        # 微表情100% + 眼神100%，身体语言仅关键摘要
        body_summary = body_base.split("\n")[0] if body_base else ""  # 首行摘要
        action_summary = action_desc.split("\n")[0] if action_desc else ""
        return (
            f"{micro}\n\n{eyes}",
            f"Body hint: {body_summary}\nAction hint: {action_summary}"
        )

    elif shot_type == "medium":
        # 全部包含，均衡权重
        full_body = f"{body_base}\n\n{action_desc}" if include_action else body_base
        return f"{micro}\n\n{eyes}", full_body

    else:  # wide
        # 身体语言80%，微表情/眼神仅关键摘要
        micro_summary = micro.split("\n")[0] if micro else ""  # 首行摘要
        eyes_summary = eyes.split("\n")[0] if eyes else ""
        full_action = f"{body_base}\n\n{action_desc}\n\n{action_weight}\n\n{action_props}" if include_action else body_base
        return f"Expression: {micro_summary}\nEyes: {eyes_summary}", full_action


def get_performance_prompt(
    shot_type: str,
    emotion: str = "distressed",
    action: Optional[str] = None,
    character: str = "male",
    include_anti_patterns: bool = True
) -> str:
    """
    根据情绪和动作生成表演 prompt。

    Args:
        shot_type: 景别 "wide" | "medium" | "closeup"
        emotion: 情绪类型（见 EmotionType 枚举）
        action: 动作类型（见 ActionType 枚举），可选
        character: 角色 "male" | "female"
        include_anti_patterns: 是否包含反模式约束

    Returns:
        完整的表演描述 prompt 块
    """
    # 验证输入
    shot_type = shot_type.lower().strip()
    if shot_type not in ("wide", "medium", "closeup"):
        raise ValueError(f"shot_type 必须为 'wide' / 'medium' / 'closeup'，当前值：{shot_type!r}")

    character = character.lower().strip()
    if character not in ("male", "female"):
        raise ValueError(f"character 必须为 'male' / 'female'，当前值：{character!r}")

    # 获取情绪模板
    try:
        emotion_enum = EmotionType(emotion.lower())
    except ValueError:
        valid_emotions = [e.value for e in EmotionType]
        raise ValueError(f"emotion 必须为 {valid_emotions}，当前值：{emotion!r}")

    emotion_template = EMOTION_TEMPLATES[emotion_enum]

    # 获取动作描述（如果提供）
    action_description = {}
    if action:
        try:
            action_enum = ActionType(action.lower())
            action_description = ACTION_DESCRIPTIONS[action_enum]
        except ValueError:
            valid_actions = [a.value for a in ActionType]
            raise ValueError(f"action 必须为 {valid_actions}，当前值：{action!r}")

    # 根据景别获取加权内容
    face_content, body_content = _get_weighted_content(
        emotion_template,
        action_description,
        shot_type,
        include_action=bool(action)
    )

    # 构建最终 prompt
    char_label = "Male Lead" if character == "male" else "Female Lead"
    shot_label = shot_type.upper()

    parts = [f"=== {char_label} PERFORMANCE — {shot_label} ==="]
    parts.append(face_content)

    if body_content.strip():
        parts.append(f"\n{body_content}")

    if include_anti_patterns:
        parts.append(PERFORMANCE_ANTI_PATTERNS)

    return "\n".join(parts)


def get_dual_performance_prompt(
    shot_type: str,
    male_emotion: str = "distressed",
    male_action: Optional[str] = None,
    female_emotion: str = "caring",
    female_action: Optional[str] = None,
    include_anti_patterns: bool = True
) -> str:
    """
    生成双角色表演 prompt（便捷函数）。

    Args:
        shot_type: 景别
        male_emotion: 男主情绪
        male_action: 男主动作
        female_emotion: 女主情绪
        female_action: 女主动作
        include_anti_patterns: 是否包含反模式（只在最后包含一次）

    Returns:
        双角色完整表演描述
    """
    male_prompt = get_performance_prompt(
        shot_type,
        emotion=male_emotion,
        action=male_action,
        character="male",
        include_anti_patterns=False
    )

    female_prompt = get_performance_prompt(
        shot_type,
        emotion=female_emotion,
        action=female_action,
        character="female",
        include_anti_patterns=False
    )

    result = f"{male_prompt}\n\n{female_prompt}"

    if include_anti_patterns:
        result += f"\n{PERFORMANCE_ANTI_PATTERNS}"

    return result


# ── 便捷函数 ───────────────────────────────────────────────────

def get_scene01_performance(shot_type: str) -> str:
    """Scene 01 快捷方式：雪夜糕团铺门口"""
    return get_dual_performance_prompt(
        shot_type,
        male_emotion="distressed",
        male_action="sitting_collapsed",
        female_emotion="caring",
        female_action="offering_food"
    )


def get_scene02_performance(shot_type: str) -> str:
    """Scene 02 快捷方式：室内日间后厨"""
    return get_dual_performance_prompt(
        shot_type,
        male_emotion="focused_calm",
        male_action="writing_brush",
        female_emotion="confident_skilled",
        female_action="kneading_dough"
    )


# ============================================================
# 三维动作映射系统（基于豆包建议）
# ============================================================

# 身份-情绪-景别 三维动作映射
THREE_DIMENSIONAL_ACTION_MAP = {
    # 喜
    "joyful": {
        "文官": {
            "closeup": "眼尾带笑 指尖捻胡须 嘴角微扬",
            "medium": "一手负身后 一手轻叩桌面 肩膀放松",
            "wide": "负手而立 脚步平稳向前走"
        },
        "侍女": {
            "closeup": "捂嘴笑 梨涡显露 耳尖泛红",
            "medium": "指尖绞帕子 肩膀微颤 头微微侧向一边",
            "wide": "踮脚小步跑 衣摆轻轻晃动"
        },
        "侠客": {
            "closeup": "嘴角上扬 眼中有光 眉宇舒展",
            "medium": "抱拳行礼 腰杆挺直 动作利落",
            "wide": "大步流星 衣袂飘扬 步伐轻快"
        },
        "百姓": {
            "closeup": "咧嘴笑 眼睛眯成缝 面部肌肉自然放松",
            "medium": "拍手 肩膀晃动 身体微微后仰",
            "wide": "蹦跳着走 双臂摆动 步伐轻快"
        }
    },
    # 怒
    "angry": {
        "文官": {
            "closeup": "眉头紧蹙 下颌绷紧 牙关轻咬",
            "medium": "攥紧书卷 指节泛白 气息变粗",
            "wide": "快步来回踱步 衣袍翻飞"
        },
        "侍女": {
            "closeup": "眼眶泛红 嘴唇抿紧 睫毛颤动",
            "medium": "攥紧衣角 肩膀微颤 呼吸急促",
            "wide": "转身快步走 衣摆甩动"
        },
        "侠客": {
            "closeup": "眼神凌厉 眉心紧锁 嘴角下撇",
            "medium": "按剑的手收紧 剑鞘微微抖动 肌肉紧绷",
            "wide": "大步向前 衣袍猎猎 气势逼人"
        },
        "百姓": {
            "closeup": "瞪大眼睛 脸颊鼓起 嘴唇颤抖",
            "medium": "双手叉腰 身体前倾 指指点点",
            "wide": "跺脚 转身 气冲冲走开"
        }
    },
    # 悲/忧伤
    "sad": {
        "文官": {
            "closeup": "眼睑下垂 目光涣散 嘴角下撇",
            "medium": "长叹一声 肩膀微塌 手扶桌沿",
            "wide": "缓步独行 背影萧索 衣袍下垂"
        },
        "侍女": {
            "closeup": "眼眶含泪 睫毛湿润 嘴唇微颤",
            "medium": "低头敛目 手指绞帕子 肩膀微抖",
            "wide": "低头缓步走 衣摆拖地 步履沉重"
        },
        "侠客": {
            "closeup": "眼神空洞 面无表情 下颌紧绷",
            "medium": "单手扶剑 肩膀微垮 目光望向远方",
            "wide": "独自站立 风吹衣袂 孤寂身影"
        },
        "百姓": {
            "closeup": "眉头皱起 眼中含泪 嘴角颤抖",
            "medium": "双手抱胸 身体微微蜷缩 肩膀抖动",
            "wide": "蹲在地上 双手掩面 身体颤抖"
        }
    },
    # 恐惧
    "fearful": {
        "文官": {
            "closeup": "瞳孔放大 脸色苍白 冷汗微现",
            "medium": "双手微颤 衣袖晃动 身体僵硬",
            "wide": "后退几步 脚步踉跄 几欲跌倒"
        },
        "侍女": {
            "closeup": "眼睛睁大 瞳孔收缩 嘴唇发白",
            "medium": "双手护胸 肩膀耸起 身体后缩",
            "wide": "蹲下躲藏 双手抱头 身体蜷缩"
        },
        "侠客": {
            "closeup": "眼神警惕 肌肉紧绷 额头青筋",
            "medium": "右手按剑 左手护身 蓄势待发",
            "wide": "半蹲姿态 目光扫视 随时应变"
        },
        "百姓": {
            "closeup": "面如土色 双眼圆睁 嘴巴张大",
            "medium": "双手乱挥 身体摇晃 步履不稳",
            "wide": "转身就跑 跌跌撞撞 慌不择路"
        }
    },
    # 平静/中性
    "neutral": {
        "文官": {
            "closeup": "目光平和 面容端正 呼吸均匀",
            "medium": "双手交叠于身前 腰背挺直 气定神闲",
            "wide": "缓步而行 步履稳健 仪态端庄"
        },
        "侍女": {
            "closeup": "眉眼低垂 嘴角微抿 表情恬静",
            "medium": "双手垂于身侧 身体微微前倾 恭敬姿态",
            "wide": "小步跟随 低头垂眼 规矩行走"
        },
        "侠客": {
            "closeup": "目光沉静 面无表情 眼神深邃",
            "medium": "抱剑而立 肌肉放松 警惕但不紧张",
            "wide": "独自站立 目光远眺 沉默如山"
        },
        "百姓": {
            "closeup": "表情自然 眼神平淡 无悲无喜",
            "medium": "双手自然垂下 身体放松 日常姿态",
            "wide": "正常行走 步伐平稳 神态从容"
        }
    },
    # 惊讶
    "surprised": {
        "文官": {
            "closeup": "眼睛睁大 眉毛上扬 嘴巴微张",
            "medium": "手中动作停顿 书卷停在半空 身体前倾",
            "wide": "猛地站起 衣袍翻动 动作急促"
        },
        "侍女": {
            "closeup": "瞳孔放大 嘴唇微张 手掩嘴唇",
            "medium": "手中物品停住 身体后仰 惊愕姿态",
            "wide": "脚步停住 身体一震 呆立原地"
        },
        "侠客": {
            "closeup": "眼神一凝 眉头微皱 警觉骤起",
            "medium": "按剑的手收紧 身体重心下沉 蓄势待发",
            "wide": "脚步一顿 目光锁定 全身紧绷"
        },
        "百姓": {
            "closeup": "瞪大眼睛 张大嘴巴 表情凝固",
            "medium": "双手僵在半空 身体僵硬 动作停滞",
            "wide": "停下脚步 呆立原地 目瞪口呆"
        }
    }
}

# 景别通用关键词
SHOT_TYPE_KEYWORDS = {
    "closeup": "眼尾泛红 瞳孔微缩 指节泛白 嘴角下意识抽搐 睫毛颤动 喉结滚动",
    "medium": "肩膀微垮 指尖无意识摩挲袖口 身体微微侧转 下颌绷紧 呼吸起伏",
    "wide": "快步来回踱步 猛地甩袖 瘫坐在地上 弓着背慢慢往前走 衣袂翻飞"
}

# 身份通用关键词
IDENTITY_KEYWORDS = {
    "文官": "捋胡须 指尖叩击桌面 负手而立 躬身行礼 甩袖",
    "侍女": "屈膝行礼 绞帕子 垂眼敛眉 小步快走 手捧托盘",
    "侠客": "按剑 翻身 脚尖点地 衣袂翻飞 蹲身落地",
    "百姓": "搓手 躬身 肩膀佝偻 拎着篮子 小跑避让"
}

# 动态优化关键词
DYNAMIC_KEYWORDS = "动作连贯性 动态模糊 前置动作停顿 后置动作惯性 肢体过渡自然 微表情细节"

# 表演反模式
PERFORMANCE_ANTI_PATTERNS = """
=== PERFORMANCE ANTI-PATTERNS (Critical - Always Avoid) ===
1. NO AI TYPICAL "FAKE SMILE"
   - Avoid: raised cheeks, curved mouth, visible teeth when not appropriate
   - Real expression: subtle, context-appropriate, micro-movements only

2. NO STIFF "STOCK PHOTO" POSES
   - Avoid: symmetrical postures, hands in perfect positions
   - Real pose: natural asymmetry, slight imperfections, lived-in quality

3. NO ANATOMICAL ERRORS
   - Hand proportions: correct finger joint lengths, natural hand shape
   - Body proportions: correct limb lengths, natural joint positions
   - NO rubber fingers, NO impossible joint angles

4. NO VACANT STARES
   - Eyes must have clear focus point
   - Pupils should respond to light direction
   - Catch lights consistent with scene lighting

5. NO FLOATING/GRAVITY ISSUES
   - Weight must be clearly grounded
   - Contact points with surfaces must show pressure
   - Shadows must support the sense of grounding

6. NO OVERLY CLEAN/PERFECT APPEARANCE
   - Working characters should show signs of work
   - Clothes may have wrinkles, dust, wear
   - Hands may be dirty, flour-covered, etc.

7. NO MODERN BODY LANGUAGE
   - Period-appropriate posture and movement
   - Traditional ways of sitting, standing, working
   - No modern casual poses in period pieces
"""


def get_3d_performance_prompt(
    emotion: str,
    identity: str,
    shot_type: str,
    include_keywords: bool = True,
    include_anti_patterns: bool = True
) -> str:
    """
    三维动作映射生成表演提示词

    Args:
        emotion: 情绪 "joyful" | "angry" | "sad" | "fearful" | "neutral" | "surprised"
        identity: 身份 "文官" | "侍女" | "侠客" | "百姓"
        shot_type: 景别 "closeup" | "medium" | "wide"
        include_keywords: 是否包含通用关键词
        include_anti_patterns: 是否包含反模式

    Returns:
        表演提示词
    """
    # 标准化输入
    emotion = emotion.lower().strip()
    identity = identity.strip()
    shot_type = shot_type.lower().strip()

    # 获取动作描述
    emotion_map = THREE_DIMENSIONAL_ACTION_MAP.get(emotion, THREE_DIMENSIONAL_ACTION_MAP["neutral"])
    identity_map = emotion_map.get(identity, emotion_map.get("文官", {}))
    action_desc = identity_map.get(shot_type, identity_map.get("medium", ""))

    # 构建提示词
    parts = [
        "=== PERFORMANCE SYSTEM ===",
        f"Emotion: {emotion}",
        f"Identity: {identity}",
        f"Shot Type: {shot_type}",
        "",
        f"Action Description: {action_desc}"
    ]

    # 添加景别关键词
    if include_keywords:
        shot_keywords = SHOT_TYPE_KEYWORDS.get(shot_type, "")
        identity_keywords = IDENTITY_KEYWORDS.get(identity, "")
        parts.extend([
            "",
            f"Shot Keywords: {shot_keywords}",
            f"Identity Keywords: {identity_keywords}",
            f"Dynamic Keywords: {DYNAMIC_KEYWORDS}"
        ])

    # 添加反模式
    if include_anti_patterns:
        parts.append(PERFORMANCE_ANTI_PATTERNS)

    return "\n".join(parts)


def get_multi_character_performance(
    characters: list,
    shot_type: str,
    include_anti_patterns: bool = True
) -> str:
    """
    多角色表演提示词

    Args:
        characters: 角色列表 [{"identity": "文官", "emotion": "angry"}, ...]
        shot_type: 景别
        include_anti_patterns: 是否包含反模式

    Returns:
        多角色表演提示词
    """
    parts = ["=== MULTI-CHARACTER PERFORMANCE SYSTEM ==="]

    for i, char in enumerate(characters, 1):
        identity = char.get("identity", "文官")
        emotion = char.get("emotion", "neutral")
        name = char.get("name", f"角色{i}")

        emotion_map = THREE_DIMENSIONAL_ACTION_MAP.get(emotion, THREE_DIMENSIONAL_ACTION_MAP["neutral"])
        identity_map = emotion_map.get(identity, emotion_map.get("文官", {}))
        action_desc = identity_map.get(shot_type, identity_map.get("medium", ""))

        parts.extend([
            "",
            f"--- {name} ({identity}) ---",
            f"Emotion: {emotion}",
            f"Action: {action_desc}"
        ])

    if include_anti_patterns:
        parts.append(PERFORMANCE_ANTI_PATTERNS)

    return "\n".join(parts)


def list_emotions() -> list:
    """列出所有情绪类型"""
    return list(THREE_DIMENSIONAL_ACTION_MAP.keys())


def list_identities() -> list:
    """列出所有身份类型"""
    return list(IDENTITY_KEYWORDS.keys())


def get_performance_keywords(identity: str, shot_type: str) -> str:
    """获取表演关键词"""
    shot_keywords = SHOT_TYPE_KEYWORDS.get(shot_type, "")
    identity_keywords = IDENTITY_KEYWORDS.get(identity, "")
    return f"{shot_keywords}, {identity_keywords}, {DYNAMIC_KEYWORDS}"


def get_emotion_performance_keywords(emotion: str, identity: str, shot_type: str) -> str:
    """获取情绪化表演关键词（三维映射）"""
    emotion_map = THREE_DIMENSIONAL_ACTION_MAP.get(emotion, THREE_DIMENSIONAL_ACTION_MAP["neutral"])
    identity_map = emotion_map.get(identity, emotion_map.get("文官", {}))
    action_desc = identity_map.get(shot_type, identity_map.get("medium", ""))

    shot_keywords = SHOT_TYPE_KEYWORDS.get(shot_type, "")
    identity_keywords = IDENTITY_KEYWORDS.get(identity, "")

    return f"{action_desc}, {shot_keywords}, {identity_keywords}"

if __name__ == "__main__":
    # 测试 Scene 02 表演
    print("=" * 60)
    print("Scene 02 室内日间后厨 - 全景")
    print("=" * 60)
    print(get_scene02_performance("wide"))
    print("\n")

    print("=" * 60)
    print("Scene 01 雪夜糕团铺 - 中景")
    print("=" * 60)
    print(get_scene01_performance("medium"))
