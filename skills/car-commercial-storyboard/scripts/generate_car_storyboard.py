#!/usr/bin/env python3
"""
汽车广告分镜生成器
使用 GPT-Image-2 生图，支持九宫格分镜、多种运镜方式、多种镜头焦距和相机型号。
"""

import requests
import base64
import os
import argparse
from datetime import datetime
import json

# 默认配置（使用 DMXAPI 代理访问 GPT-Image-2）
_DMXAPI_BASE = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn")
DEFAULT_API_URL = f"{_DMXAPI_BASE}/v1/images/edits"
DEFAULT_MODEL   = "gpt-image-2"
# 备用模型可扩展
DEFAULT_ASPECT_RATIO = "16:9"
DEFAULT_SIZE = "2K"
DEFAULT_OUTPUT_DIR = "./output"

# 分辨率映射表
RESOLUTION_MAP = {
    "16:9": {
        "1K": "1376x768",
        "2K": "2752x1536",
        "4K": "5504x3072"
    },
    "9:16": {
        "1K": "768x1376",
        "2K": "1536x2752",
        "4K": "3072x5504"
    },
    "1:1": {
        "1K": "1024x1024",
        "2K": "2048x2048",
        "4K": "4096x4096"
    }
}

# 布局模式
LAYOUT_MODES = {
    "single": "单张大图模式",
    "grid-3x3": "3x3九宫格分镜模式（适合视频分镜）"
}

# 场景类型
SCENE_TYPES = {
    "coastal": "海岸线场景（海边公路、海滩、港口）",
    "mountain": "山地场景（山脉、高原、峡谷）",
    "urban": "城市场景（城市街道、高速公路、都市夜景）",
    "desert": "沙漠场景（沙漠、荒野、戈壁）",
    "nature": "自然场景（森林、草原、湖泊）"
}

# 场景关键词识别
SCENE_KEYWORDS = {
    "coastal": ["海岸", "海边", "海滩", "港口", "海", "sea", "ocean", "coast", "beach", "harbor", "port"],
    "mountain": ["山", "山脉", "高原", "峡谷", "mountain", "mountains", "canyon", "plateau", "alpine", "阿尔卑斯"],
    "urban": ["城市", "街道", "高速", "都市", "city", "street", "highway", "urban", "downtown", "metropolis"],
    "desert": ["沙漠", "荒野", "戈壁", "desert", "wilderness", "wasteland", "dune"],
    "nature": ["森林", "草原", "湖泊", "森林", "forest", "prairie", "grassland", "lake", "park", "national park", "黄石", "森林"]
}

# 运镜提示词模板（含构图/光线知识）
CAMERA_MOVE_PROMPTS = {
    "aerial": """航拍俯瞰镜头（God's eye view），从高空垂直或斜角俯瞰，
展现车辆在壮丽自然景观中的渺小与力量，缓慢推入，远景展现宏大场景。
S形曲线构图，道路作为引导线，车辆渺小强调环境震撼感。""",

    "chase": """侧面动态跟拍镜头，摄影机与车辆相对静止，主体清晰，
路面动态模糊，展现速度感。三分法构图，道路标线引导视线，
低角度跟拍，捕捉车轮和车身动感，运动模糊效果。""",

    "lead": """前置跟拍镜头，摄影机在车辆前方跟随拍摄，
中心对称构图，车头置于画面中心，道路纵向标线引导，
远景天际分层背景，感受车辆前行的速度感，引擎轰鸣的视觉呈现。""",

    "tracking": """后方平稳跟拍镜头，摄影机在车辆后方跟随拍摄，
展现车辆行驶的稳定和舒适，平稳运镜，生活化的场景。""",

    "close-up": """特写镜头，聚焦车辆细节（车灯、格栅、轮毂、内饰等），
缓慢推入，展现精致的工艺和质感，细腻的光影。""",

    "wide": """广角镜头，展现车辆与周围环境的和谐，
广阔的空间感，背景清晰可见，环境作为陪衬。""",

    "low-angle": """低角度仰拍镜头，从地面仰视车辆，
展现车辆的霸气和力量感，道路标线作为引导线，
车灯/逆光轮廓刺破画面，压迫感十足。""",

    "overhead": """顶视镜头，垂直俯瞰，展现车辆行驶路线，
全景展示，适合展示车辆在复杂路况中的路线规划。"""
}

# 镜头类型
LENS_TYPES = {
    "14mm": "14mm超广角镜头，极度广阔视野，强烈的透视感，适合史诗级全景和环境展示",
    "16mm": "16mm广角镜头，广阔视野，适度的透视效果，适合风景和城市场景",
    "24mm": "24mm标准广角镜头，自然视角，平衡的透视，适合多用途场景",
    "35mm": "35mm经典人文镜头，接近人眼视角，适合生活场景和自然表现",
    "50mm": "50mm标准镜头，无畸变，真实还原，适合细节特写和质感展示",
    "85mm": "85mm人像镜头，浅景深，背景虚化，适合车辆细节和质感特写",
    "135mm": "135mm长焦镜头，极浅景深，强烈的压缩感，适合远距离跟拍和细节特写",
    "200mm": "200mm超长焦镜头，极度压缩背景，强烈的虚化，适合远距离高速跟拍"
}

# 相机型号
CAMERA_MODELS = {
    "arri-alexa": "ARRI Alexa 35，电影级传感器，15档动态范围，电影质感，高端商业广告首选",
    "red-v-raptor": "RED V-Raptor XL，8K分辨率，17档动态范围，超高清细节，现代商业广告",
    "sony-venice": "SONY Venice 2，全画幅传感器，电影质感，细腻的色彩过渡",
    "canon-c300": "Canon C300 Mark III，5.9K Super 35mm，自然肤色还原，适合人文风格",
    "blackmagic-ursa": "Blackmagic Ursa Mini Pro 12K，12K分辨率，极致细节，适合后期调色",
    "iphone-15-pro": "iPhone 15 Pro Max，Log模式，便携性，Vlog风格",
    "gopro-hero": "GoPro Hero 12 Black，超广角，运动视角",
    "dji-ronin": "DJI Ronin 4D，云台相机，平滑运镜"
}

# 电影镜头风格提示词模板
LENS_STYLES = {
    "cooke-classic": """Cooke经典镜头风格，30年代Speed Panchro传承。
清晰且具有风格，不是追求客观完美，而是主观的美感。
Cooke Look标志性特征，创造了属于时代的视觉记忆，
风格化而不失细节，电影级质感。""",

    "cooke-s2-s3": """Cooke S2/S3复古镜头风格，经典Cooke风格传承。
保留了Cooke的传承和特点，复古感强烈，
30年代电影质感，怀旧氛围，
清晰度适中，风格化明显。""",

    "cooke-s4-s5": """Cooke S4/S5现代镜头风格，紧凑镜头组设计。
保留了绝大部分Cooke风格，适应时代提高了一些分辨率，
经典与现代的平衡，既有复古感又不失清晰度，
电影级传感器表现。""",

    "creamy": """焦外虚化如奶油般柔和圆润，主体清晰锐利，梦幻氛围。
后景柔和化开，边缘光线汇聚到不同焦点，复杂背景效果。
球面镜头特性，高光点的光感更圆润，独特的视觉质感。""",

    "cinematic": """电影质感，清晰且具有风格。
色彩丰富，光影层次分明，风格化而不失细节，
光学传承，独特的视觉质感，电影级传感器表现，
丰富的色彩和光影层次，电影感强烈。""",

    "sharp": """如刀锋般锐利，细节丰富，边缘清晰，高对比度。
高光学分辨率，极致细节呈现，背景如刀锋般锐利，
主体如奶油般化开，强烈的视觉冲击。""",

    "vintage": """复古怀旧，古早感觉，轻微色散，梦幻氛围。
边缘有淡淡的色彩晕染，符合人眼看东西的状态，
有注视点，复古感强烈，文艺片质感。""",

    "artistic": """独特光学风格，艺术化表现，不追求绝对清晰，强调氛围感。
风格独一无二，光学传承，丰富的色彩和光影层次，
让画面更有艺术性和个性。""",

    "spherical": """球面镜头特性，同一个画面是在同一个球面上截取的。
球面可以让光线汇聚到不同的焦点上，形成独特的视觉风格和质感，
后景的焦外效果会更柔和，高光点的光感会更圆润，
独特的球面镜头特性。""",

    "focus-control": """可控焦点，想要清晰的时候清晰，想要风格化的时候风格化。
给创作者更多的创作空间和表达自由，
焦外虚化和清晰度的可控平衡，灵活的视觉表现。""",

    "bokeh-soft": """柔和焦外，后景的焦外效果会更柔和。
没有明显的边缘线条，过渡自然，
主体清晰，背景柔化，梦幻氛围，
浅景深，焦外虚化明显，人像质感。""",

    "flare-style": """风格化炫光，有独特的炫光效果。
产生梦幻的光晕、光斑效果，
光线进入镜头时产生艺术化的炫光表现，
梦幻氛围，适合风格化镜头、艺术短片。""",

    "low-dispersion": """低色散，镜头对色散的控制能力强。
不会出现边缘紫边或绿边，色彩纯净，
高对比度，边缘清晰，细节丰富，
适合追求极致清晰度和色彩纯净的场景。""",

    "robert-alblas": """Robbert Alblas Car Films标志性电影感。
特写镜头主导，50mm-85mm中长焦镜头，浅景深+背景虚化，主体突出，背景柔化。
室内场景为主，光线控制精准，背景简洁，构图稳定。
舒缓缓慢，不突兀，平滑过渡。""",

    "robert-alblas-night": """Robbert Alblas城市夜景风格，标志性电影质感。
低饱和度（100-130），中对比度（40-60），城市夜景色调（暗色背景+亮色光源）。
胶片复古感，电影质感强烈。
85mm长焦镜头主导（100%），特写镜头（100%），浅景深+背景虚化，主体突出，背景柔化。
城市夜景场景为主（40-50%），室内场景为辅（40-50%），光线控制精准，城市灯光、霓虹灯、车灯反射。
特写镜头主导，舒缓缓慢，不突兀，平滑过渡，强调细节。
夜晚的氛围，暗色背景，亮色光源，城市夜景的浪漫和神秘。""",

    "geo-epic": """地理史诗美学视觉风格（无科学标注版）。
星球研究所式高冷史诗美学，但去除所有科学元素（无指南针、无比例尺、无数据标注）。
仅保留地理视觉质感：
• 精细等高线纹理叠加，如地形图的等高线美感，半透明覆盖在山川地貌上
• 灰蓝/深蓝色调主导，低饱和度（28-35%），偏暗色调（20-50%亮度）
• 高对比度光影，冷暖对比微妙
• 航拍大景的史诗感，壮丽地貌的视觉震撼
• 雪山、冰川、高原的冷峻美学
• 环境层次分明，大气透视感强烈
电影级宽画幅，地理纪录片质感，极简而震撼。"""
}


def load_config():
    """从 ~/.openclaw/openclaw.json 读取配置"""
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    try:
        with open(config_path) as f:
            return json.load(f)
    except Exception:
        return {}


def encode_reference_image(image_path):
    """编码参考图为Base64，同时返回MIME type"""
    if not image_path or not os.path.exists(image_path):
        return None, None

    ext = os.path.splitext(image_path)[1].lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp"
    }
    mime_type = mime_map.get(ext, "image/jpeg")

    with open(image_path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8'), mime_type


def describe_location_with_gemini(location_name, api_key):
    """调用 Gemini Flash 获取地点视觉特征描述，用于注入图像生成提示词"""
    if not api_key or not location_name or location_name == "unknown":
        return None

    prompt = (
        f'你是专业的电影摄影指导。请描述"{location_name}"的视觉特征，'
        f'用于生成电影级汽车广告画面。\n'
        f'只描述摄影机能拍到什么，不要历史文化背景：\n'
        f'地形地貌（颜色、形状、规模感）、典型植被（种类、颜色、季节特征）、'
        f'建筑元素（如有，风格特征）、光线质感（太阳角度、典型时段、大气效果）、'
        f'标志性视觉元素（让这里独一无二的东西）。\n'
        f'中文回答，4-6句话，聚焦视觉细节。'
    )

    payload = {
        "model": "gemini-2.0-flash-preview",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 400,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        print(f"🌍 正在调用 Gemini 描述地点视觉特征: {location_name}...")
        resp = requests.post(
            f"{_DMXAPI_BASE}/v1/chat/completions",
            json=payload, headers=headers, timeout=20
        )
        resp.raise_for_status()
        desc = resp.json()["choices"][0]["message"]["content"].strip()
        print(f"✅ Gemini 地点描述成功")
        return desc
    except Exception as e:
        print(f"⚠️ Gemini 地点描述调用失败: {e}，跳过地点信息")
        return None


def detect_scene_type(prompt):
    """自动检测场景类型"""
    prompt_lower = prompt.lower()

    for scene_type, keywords in SCENE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in prompt_lower:
                return scene_type

    return None


def generate_image(prompt, scene_type, camera_move, lens_type, camera_model, lens_style, aspect_ratio, size, output_dir, api_key, layout, reference_image, reference_images, location_prompt="", offline=False):
    """调用 Gemini API 生成图片"""

    # 获取相机提示词
    camera_model_prompt = CAMERA_MODELS.get(camera_model, "") if camera_model else ""

    # 获取电影镜头风格提示词
    lens_style_prompt = LENS_STYLES.get(lens_style, "") if lens_style else ""

    # 获取运镜提示词
    camera_prompt = CAMERA_MOVE_PROMPTS.get(camera_move, "") if camera_move else ""

    # 获取镜头焦距提示词
    lens_prompt = LENS_TYPES.get(lens_type, "") if lens_type else ""

    # 处理参考图（支持单张和多张）
    reference_image_list = []

    # 首先处理 reference_images 参数（多张参考图）
    if reference_images:
        for img_path in reference_images:
            if os.path.exists(img_path):
                data, mime = encode_reference_image(img_path)
                if data:
                    reference_image_list.append({"data": data, "mimeType": mime})

    # 然后处理 reference_image 参数（单张参考图，向后兼容）
    if reference_image and os.path.exists(reference_image):
        data, mime = encode_reference_image(reference_image)
        if data:
            # 避免重复（简单以路径比对）
            already = any(
                i["data"] == data for i in reference_image_list
            )
            if not already:
                reference_image_list.append({"data": data, "mimeType": mime})

    # 构建参考图提示词说明
    reference_prompt = ""
    if reference_image_list:
        ref_count = len(reference_image_list)
        if ref_count == 1:
            ref_source = reference_image if reference_image else (reference_images[0] if reference_images else "未知")
            reference_prompt = f"""
【参考图】
参照参考图的车辆进行生成，保持车辆外观准确。
参考图路径: {ref_source}
"""
        else:
            ref_paths = reference_images if reference_images else [reference_image]
            reference_prompt = f"""
【参考图】
参照{ref_count}张参考图的车辆进行生成，保持车辆外观准确。
参考图路径: {', '.join(ref_paths)}
"""

    # 构建布局前缀
    if layout == "grid-3x3":
        layout_prefix = """3x3电影级汽车广告分镜（Cinematic Car Commercial Storyboard）

【叙事节奏：悬念 → 切入 → 冲击 → 沉浸 → 高潮 → 余韵】

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第一行 - 开场悬念与环境铺陈】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 左上【环境大远景】：壮丽环境铺满画面，车辆在画面中极小（占比<10%），强调环境震撼感，16mm超广角，航拍俯瞰
• 中上【动态切入】：车辆侧面跟拍，强动态模糊，路面飞溅尘土/水花/雪雾，速度感爆炸，35mm，运动模糊效果
• 右上【低角度仰拍】：从地面低角度仰视车辆，霸气压迫感，车灯刺破黑暗/逆光轮廓，24mm广角，冲击力强

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第二行 - 主体冲击与细节质感】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 左中【正面对冲】：车辆正面向镜头冲来，低角度，中心对称构图，视觉冲击力max，24mm，f/2.8浅景深
• 中中【局部特写】：只展示车轮+轮毂细节，路面飞溅，环境光映在轮毂上，85mm特写，质感极致
• 右中【车内POV】：透过挡风玻璃看到前方景色，沉浸式第一人称，24mm广角，框架式构图

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【第三行 - 高潮时刻与余韵收尾】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 左下【车灯特写】：前灯/尾灯特写，光线穿透环境（雾气/尘土/水汽），环境光反射在灯壳上，极近距离，梦幻光效
• 中下【高潮全景】：车辆穿越场景最绚丽处，环境光效环绕车身，史诗级画面，16mm超广角，电影感max
• 右下【远去余韵】：车辆驶向远方，尾灯渐行渐远，路面留下轮胎轨迹，留白构图，余韵悠长

【打破规整的关键】
• 景别极端化：超大远景 ↔ 极近距离特写，拒绝中庸
• 动静对比：动态模糊（速度） ↔ 静止特写（质感）
• 角度多样化：航拍俯瞰、低角度仰拍、车内POV、正面冲击
• 叙事节奏：开场（震撼）→ 切入（速度）→ 冲击（力量）→ 沉浸（情感）→ 高潮（史诗）→ 余韵（回味）
• 非对称构图：三分法、留白、引导线，拒绝死板居中

"""
    else:
        layout_prefix = ""

    # 构建基础提示词（含电影质感基底）
    base_prompt = f"""汽车广告分镜图，{aspect_ratio}宽画幅。

【电影质感基底】
调色：低饱和度（0.65-0.8），暖橙天空/车灯 + 冷灰路面/阴影冷暖对比，沉静高级感。
光线：黄金时刻45度侧光，车身立体感强，阴影柔和。
分层背景：远景柔和低饱和 / 中景清晰适度对比 / 近景车辆高对比突出。

{camera_prompt}
"""

    # 添加参考图说明
    if reference_prompt:
        base_prompt += f"""{reference_prompt}
"""

    # 添加地点信息
    if location_prompt:
        base_prompt += f"""{location_prompt}
"""

    # 添加电影镜头风格
    if lens_style_prompt:
        base_prompt += f"""{lens_style_prompt}

"""

    # 添加镜头焦距
    if lens_prompt:
        base_prompt += f"""镜头焦距：{lens_prompt}。

"""

    # 添加相机信息
    if camera_model_prompt:
        base_prompt += f"""相机：{camera_model_prompt}。

"""

    # 完整场景描述
    if reference_image_list:
        ref_count = len(reference_image_list)
        ref_text = f"{ref_count}张参考图" if ref_count > 1 else "参考图"
        scene_description = f"""场景描述：{prompt}。

【车辆细节一致性要求 - 极其重要】
1. 必须严格参照{ref_text}的车辆外观进行生成，保持像素级一致。
2. 车身颜色、漆面质感必须与参考图完全一致。
3. 车身形状、线条轮廓、车窗比例必须与参考图完全一致。
4. 轮毂样式、辐条数量、颜色必须与参考图完全一致。
5. 车标位置、大小、样式必须与参考图完全一致。
6. 前灯组、尾灯组的设计、形状、颜色必须与参考图完全一致。
7. 轮胎、卡钳、刹车盘的细节必须与参考图完全一致。
8. 所有九宫格分镜中的车辆外观必须保持一致，不得有差异。

【画面丰富度要求】
1. 前景元素：符合场景特征的自然元素增加画面层次感
2. 中景主体：车辆清晰锐利，光影质感突出
3. 远景背景：与场景匹配的环境纵深（天空、地平线、地形等）
4. 动态元素：符合场景的自然动态（扬尘、水花、气流、光线变化等）
5. 细节点缀：车窗反光、地面倒影、车身质感

【光影融合要求】
1. 车辆光影必须与当前场景环境自然融合，不得有割裂感。
2. 车身反光必须反映场景实际光源（阳光、路灯、环境散射等）。
3. 保持车辆金属漆面质感的同时，融入场景整体氛围。
4. 光线冷暖对比符合场景时段和天气条件。
5. 明暗层次：高光、中间调、阴影层次分明

【环境一致性】
1. 保持与真实地理环境一致的建筑、植被、道路等特征。
2. 场景氛围必须贯穿所有分镜，保持统一的时段、天气和光线。
3. 环境元素（地形、植被、气候等）与场景描述严格对应。"""
    else:
        scene_description = f"""场景描述：{prompt}。

重要约束：
1. 保持车辆外观准确，光影与环境一致，质感真实。
2. 保持与真实地理环境一致的建筑、植被、道路等特征。"""

    full_prompt = layout_prefix + base_prompt + scene_description

    # 构建 Gemini 格式 payload
    parts = []
    for img in reference_image_list:
        parts.append({"inlineData": {"mimeType": img["mimeType"], "data": img["data"]}})
    parts.append({"text": full_prompt})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": size}
        }
    }

    # 请求头（Gemini 格式）
    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json"
    }

    print("=" * 60)
    print("🚗 开始生成汽车广告分镜图片...")
    print("=" * 60)
    if scene_type:
        print(f"场景类型: {scene_type} ({SCENE_TYPES.get(scene_type, '未知')})")
    if camera_move:
        print(f"运镜方式: {camera_move} ({CAMERA_MOVE_PROMPTS.get(camera_move, '未知')[:50]}...)")
    if lens_style:
        print(f"电影镜头风格: {lens_style} ({LENS_STYLES.get(lens_style, '未知')[:50]}...)")
    if lens_type:
        print(f"镜头焦距: {lens_type} ({LENS_TYPES.get(lens_type, '未知')})")
    if camera_model:
        print(f"相机型号: {camera_model} ({CAMERA_MODELS.get(camera_model, '未知')})")
    print(f"布局模式: {layout} ({LAYOUT_MODES.get(layout, '未知')})")
    print(f"宽高比: {aspect_ratio} ({RESOLUTION_MAP[aspect_ratio][size]})")
    print(f"分辨率: {size}")
    print(f"场景描述: {prompt}")

    # 显示参考图信息
    if reference_image_list:
        ref_count = len(reference_image_list)
        if ref_count == 1:
            ref_path = reference_image if reference_image else (reference_images[0] if reference_images else "未知")
            print(f"参考图: {ref_path}")
            print(f"   参考图模式：✅ 启用（Gemini 将使用参考图中的车辆样式）")
        else:
            ref_paths = reference_images if reference_images else []
            print(f"参考图: {ref_count}张")
            for i, path in enumerate(ref_paths, 1):
                print(f"   {i}. {path}")
            print(f"   参考图模式：✅ 启用（Gemini 将使用所有参考图中的车辆样式）")
    else:
        print(f"参考图: 无")

    if location_prompt:
        print(f"地点描述：✅ 启用（Gemini 地点视觉描述）")
    else:
        print(f"地点: 未指定（无地点视觉描述）")
    if offline:
        print(f"离线模式: ✅ 启用")
    print("=" * 60)

    try:
        print("📡 正在向 Gemini API 发送请求...")
        print(f"   使用API Key: {api_key[:20]}...")
        if reference_image_list:
            ref_count = len(reference_image_list)
            total_size = sum(len(img["data"]) for img in reference_image_list)
            if ref_count == 1:
                print(f"   参考图已编码: {total_size} 字符")
            else:
                print(f"   {ref_count}张参考图已编码: 总计 {total_size} 字符")
        print(f"   发送请求...")

        response = requests.post(DEFAULT_API_URL, json=payload, headers=headers, timeout=300)
        response.raise_for_status()

        result = response.json()
        print("✓ API 响应成功！")

        # 创建输出目录
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 解析 Gemini 响应
        if 'candidates' in result and len(result['candidates']) > 0:
            for part in result['candidates'][0]['content']['parts']:
                if 'inlineData' in part:
                    image_bytes = base64.b64decode(part['inlineData']['data'])

                    # 生成文件名
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    name_parts = ["car"]
                    if scene_type:
                        name_parts.append(scene_type)
                    if camera_move:
                        name_parts.append(camera_move)
                    if lens_style:
                        name_parts.append(lens_style)
                    if reference_image_list:
                        name_parts.append("ref")
                    if lens_type:
                        name_parts.append(lens_type)
                    if camera_model:
                        name_parts.append(camera_model.replace("-", "_"))
                    if location_prompt and not offline:
                        name_parts.append("geo")
                    name_parts.append(timestamp)
                    filename = "_".join(name_parts) + ".png"
                    filepath = os.path.join(output_dir, filename)

                    with open(filepath, 'wb') as f:
                        f.write(image_bytes)

                    file_size = os.path.getsize(filepath) / 1024
                    print(f"✓ 图片已保存: {filepath} ({file_size:.2f} KB)")

                    # 保存元数据
                    metadata = {
                        "scene_type": scene_type,
                        "camera_move": camera_move,
                        "lens_style": lens_style,
                        "lens_type": lens_type,
                        "camera_model": camera_model,
                        "layout": layout,
                        "aspect_ratio": aspect_ratio,
                        "size": size,
                        "resolution": RESOLUTION_MAP[aspect_ratio][size],
                        "prompt": prompt,
                        "full_prompt": full_prompt,
                        "reference_images": reference_images if reference_images else ([reference_image] if reference_image and os.path.exists(reference_image) else None),
                        "reference_image_count": len(reference_image_list) if reference_image_list else 0,
                        "location_visual_desc": location_prompt if location_prompt else None,
                        "offline": offline,
                        "generated_at": datetime.now().isoformat(),
                        "mode": "reference" if reference_image_list else "standard"
                    }

                    metadata_file = filepath.replace('.png', '_metadata.json')
                    with open(metadata_file, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, ensure_ascii=False, indent=2)

                    print(f"✓ 元数据已保存: {metadata_file}")
                    print("=" * 60)
                    print("✅ 生成完成！")
                    print("=" * 60)

                    return filepath

        print("❌ 未找到图片数据")
        return None

    except requests.exceptions.RequestException as e:
        print(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"HTTP 状态码: {e.response.status_code}")
            print(f"响应内容: {e.response.text}")
        return None

    except Exception as e:
        print(f"❌ 发生错误: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description="生成旅拍汽车广告分镜图片（Gemini 3 Pro Image Preview）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
场景类型：
  coastal    海岸线场景（海边公路、海滩、港口）
  mountain   山地场景（山脉、高原、峡谷）
  urban      城市场景（城市街道、高速公路、都市夜景）
  desert     沙漠场景（沙漠、荒野、戈壁）
  nature     自然场景（森林、草原、湖泊）

运镜方式：
  aerial     航拍俯瞰（史诗大片、壮丽场景）
  chase      动态跟拍侧面（活力动感、城市穿梭）
  lead       前置跟拍（速度感、性能展示）
  tracking   平稳跟拍后方（生活场景、舒适感）
  close-up   特写镜头（豪华质感、细节展示）
  wide       广角镜头（史诗大片、环境展示）
  low-angle  低角度仰拍（力量感、霸气）
  overhead   顶视镜头（全景展示、路线规划）

镜头型号（焦距）：
  14mm       14mm超广角镜头（极度广阔视野，强烈透视感）
  16mm       16mm广角镜头（广阔视野，适度透视效果）
  24mm       24mm标准广角镜头（自然视角，平衡透视）
  35mm       35mm经典人文镜头（接近人眼视角）
  50mm       50mm标准镜头（无畸变，真实还原）
  85mm       85mm人像镜头（浅景深，背景虚化）
  135mm      135mm长焦镜头（极浅景深，强烈压缩感）
  200mm      200mm超长焦镜头（极度压缩背景，强烈虚化）

相机型号：
  arri-alexa      ARRI Alexa 35（电影级传感器，15档动态范围）
  red-v-raptor    RED V-Raptor XL（8K分辨率，17档动态范围）
  sony-venice     SONY Venice 2（全画幅传感器，电影质感）
  canon-c300      Canon C300 Mark III（5.9K Super 35mm，自然肤色）
  blackmagic-ursa Blackmagic Ursa Mini Pro 12K（12K分辨率）
  iphone-15-pro   iPhone 15 Pro Max（Log模式，便携性，Vlog风格）
  gopro-hero      GoPro Hero 12 Black（超广角，运动视角）
  dji-ronin       DJI Ronin 4D（云台相机，平滑运镜）

电影镜头风格：
  cooke-classic   Cooke经典风格（30年代Speed Panchro传承，Cooke Look）
  cooke-s2-s3     Cooke S2/S3复古风格（经典Cooke风格，复古感强烈）
  cooke-s4-s5     Cooke S4/S5现代风格（经典与现代平衡，提高分辨率）
  creamy           奶油感焦外（柔和圆润，梦幻氛围，球面镜头）
  cinematic        电影质感（清晰且有风格，光影层次分明）
  sharp            高解析度（如刀锋般锐利，细节丰富）
  vintage          复古怀旧（古早感觉，轻微色散，文艺质感）
  artistic         艺术化风格（独特光学，强调氛围感）
  spherical        球面镜头（独特视觉风格，高光圆润）
  focus-control    可控焦点（清晰与风格化的可控平衡）
  bokeh-soft       柔和焦外（浅景深，梦幻氛围，人像质感）
  flare-style       风格化炫光（梦幻光晕，光斑效果，艺术短片）
  low-dispersion  低色散（色彩纯净，边缘清晰，无紫边绿边）
  robert-alblas    Robbert Alblas电影感（特写主导，室内场景）
  robert-alblas-night Robbert Alblas城市夜景感（特写主导+城市夜景）

示例：
  python generate_car_storyboard.py "豪华车在阿勒泰禾木村" --location "阿勒泰禾木村" --reference-image /path/to/reference.png --lens-style robert-alblas --lens-type 85mm --camera-move close-up --camera-model arri-alexa --layout grid-3x3
        """
    )

    parser.add_argument("prompt", help="汽车 + 路线场景描述（例如：'豪华车沿着海岸线行驶'）")
    parser.add_argument("--scene-type", default=None, choices=["coastal", "mountain", "urban", "desert", "nature"], help="场景类型（自动检测，或手动指定）")
    parser.add_argument("--camera-move", default=None, choices=["aerial", "chase", "lead", "tracking", "close-up", "wide", "low-angle", "overhead"], help="运镜方式（自动选择，或手动指定）")
    parser.add_argument("--lens-style", default=None, choices=["cooke-classic", "cooke-s2-s3", "cooke-s4-s5", "creamy", "cinematic", "sharp", "vintage", "artistic", "spherical", "focus-control", "bokeh-soft", "flare-style", "low-dispersion", "robert-alblas", "robert-alblas-night", "geo-epic"], help="电影镜头风格（可选）")
    parser.add_argument("--lens-type", default=None, choices=["14mm", "16mm", "24mm", "35mm", "50mm", "85mm", "135mm", "200mm"], help="镜头型号/焦距（可选）")
    parser.add_argument("--camera-model", default=None, choices=["arri-alexa", "red-v-raptor", "sony-venice", "canon-c300", "blackmagic-ursa", "iphone-15-pro", "gopro-hero", "dji-ronin"], help="相机型号（可选）")
    parser.add_argument("--aspect-ratio", default=DEFAULT_ASPECT_RATIO, choices=["16:9", "9:16", "1:1"], help="宽高比（默认：16:9）")
    parser.add_argument("--size", default=DEFAULT_SIZE, choices=["1K", "2K", "4K"], help="分辨率（默认：2K）")
    parser.add_argument("--layout", default="grid-3x3", choices=["single", "grid-3x3"], help="布局模式（默认：grid-3x3）- single:单张大图, grid-3x3:九宫格分镜")
    parser.add_argument("--location", default="unknown", help="具体地点（例如：'阿勒泰禾木村'），脚本自动调用 Gemini 描述视觉特征")
    parser.add_argument("--location-visual", default=None, help="手动指定地点视觉描述，跳过 Gemini 调用（调试用）")
    parser.add_argument("--reference-image", default=None, help="参考图路径（Gemini 会参考图中的车辆样式进行生成）")
    parser.add_argument("--reference-images", default=None, help="多张参考图路径，逗号分隔：'img1.jpg,img2.jpg,img3.jpg'")
    parser.add_argument("--offline", action="store_true", help="离线模式（不调用 Gemini 地点描述）")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR, help="输出目录（默认：./output）")
    parser.add_argument("--api-key", default=None, help="DMX API Key（默认从 ~/.openclaw/openclaw.json 读取 dmxApiKey）")

    args = parser.parse_args()

    # 加载配置，获取 API Key（优先使用 DMMXAPI_KEY）
    config = load_config()
    dmx_api_key = config.get("dmxApiKey", os.environ.get("DMXAPI_KEY", os.environ.get("DMX_API_KEY", "")))
    api_key = args.api_key or dmx_api_key

    # 处理场景类型
    scene_type = args.scene_type
    if not scene_type:
        scene_type = detect_scene_type(args.prompt)

    # 构建地点视觉描述
    location_prompt = ""
    if not args.offline and args.location != "unknown":
        visual_desc = args.location_visual or describe_location_with_gemini(
            args.location, dmx_api_key
        )
        if visual_desc:
            location_prompt = f"【地点视觉特征】\n{visual_desc}\n\n"
    elif args.location_visual:
        location_prompt = f"【地点视觉特征】\n{args.location_visual}\n\n"

    # 处理参考图参数
    reference_images = None
    reference_image = args.reference_image

    # 优先处理 --reference-images 参数（多张参考图）
    if args.reference_images:
        try:
            reference_images = [img.strip() for img in args.reference_images.split(',') if img.strip()]
            valid_images = []
            for img_path in reference_images:
                if os.path.exists(img_path):
                    valid_images.append(img_path)
                else:
                    print(f"⚠️ 警告：参考图不存在: {img_path}")

            if valid_images:
                reference_images = valid_images
                print(f"✅ 已加载 {len(reference_images)} 张参考图")
            else:
                print("⚠️ 所有参考图都不存在，将使用通用车型")
                reference_images = None
        except Exception as e:
            print(f"⚠️ 解析参考图参数失败: {e}")
            reference_images = None

    # 检查 --reference-image 参数（向后兼容）
    if reference_image and not os.path.exists(reference_image):
        print(f"⚠️ 参考图不存在: {reference_image}，将使用通用车型")
        reference_image = None
    elif reference_image and reference_images:
        print(f"ℹ️ 同时提供了 --reference-image 和 --reference-images，将使用 --reference-images ({len(reference_images)}张图片)")

    if not reference_image and not reference_images:
        print("⚠️ 未提供参考图，将使用通用车型")
        print("   提示：使用 --reference-image 或 --reference-images 参数提供参考图")

    if not api_key:
        print("❌ 错误：未提供 API Key")
        print("   请在 ~/.openclaw/openclaw.json 设置 dmxApiKey，或使用 --api-key 参数")
        return 1

    result = generate_image(
        prompt=args.prompt,
        scene_type=scene_type,
        camera_move=args.camera_move,
        lens_type=args.lens_type,
        camera_model=args.camera_model,
        lens_style=args.lens_style,
        aspect_ratio=args.aspect_ratio,
        size=args.size,
        output_dir=args.output,
        api_key=api_key,
        layout=args.layout,
        reference_image=reference_image,
        reference_images=reference_images,
        location_prompt=location_prompt,
        offline=args.offline
    )

    return 0 if result else 1


if __name__ == "__main__":
    exit(main())
