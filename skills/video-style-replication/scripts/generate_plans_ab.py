#!/usr/bin/env python3
"""
方案A：完全复刻原视频设定
红色机甲+废土遗迹+雨崩场景
"""
import os
import base64
import requests
from pathlib import Path

API_KEY = os.environ.get("DMXAPI_KEY")
BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"

def generate_plan_a():
    """方案A：完全复刻废土设定"""
    
    prompt = """
【重要指令】
参考附件中的人物形象，完全复刻人物面部特征，生成一张包含9个分镜头的九宫格故事板图片。

【核心设定：后启示录废土风格】
这是在云南雨崩的后启示录废土世界，主角穿着做旧的红色机甲，探索被植被覆盖的远古文明遗迹。

【九宫格布局】
3行3列，共9个分镜，从左到右、从上到下，每个分镜之间有细线分隔。

【9个分镜内容】

分镜1（左上）：苏醒
- 俯视角度，主角躺在杜鹃花丛中
- 穿着做旧的红色机甲护甲，表面有划痕、掉漆、泥土
- 面部有伤痕，迷茫地睁开眼睛
- 前景：紫色杜鹃花、绿色草丛
- 背景：透过针叶林隐约可见雪山
- 色调：冷绿暗调，低饱和

分镜2（中上）：机械手
- 手部特写
- 红色机械手掌，银色金属关节
- 表面有磨损痕迹、泥土、苔藓
- 按在泥土和草丛中
- 侧光打亮金属边缘

分镜3（右上）：起身
- 主角挣扎起身，坐在草丛中
- 红色机甲在植被中显得陈旧、破损
- 低头看自己的机械手
- 周围是茂密的森林和苔藓
- 色调：冷青暗调，高对比度

分镜4（左中）：前行
- 主角背影，穿过森林
- 红色机甲背部双剑清晰可见
- 周围树干巨大，覆满苔藓和藤蔓
- 远处雾气弥漫
- 构图：人物占比<10%

分镜5（中中）：巨物
- 主角站在巨大的石质拱门遗迹前
- 拱门覆满植被、苔藓、爬藤
- 拱门高度远超森林，呈现"文明残骸"感
- 主角在画面底部中心，极小比例（<5%）
- 丁达尔光从拱门缝隙照入
- 色调：冷绿暗调，厚重感

分镜6（右中）：仰望
- 低角度仰拍，主角仰望天空
- 天空中横跨巨大的金色螺旋状星际结构
- 结构表面有微弱金色光点
- 云层穿插在结构之间
- 主角占比极小，结构占据天空大部分
- 色调：冷绿暗调+暖金色对比

分镜7（左下）：悬浮遗迹
- 主角站在神瀑前
- 瀑布上方悬浮着巨大的骷髅形石质遗迹
- 遗迹表面覆满绿植和钟乳石
- 尺寸堪比山峰
- 瀑布水汽形成雾气
- 主角占比<5%

分镜8（中下）：最终遗迹
- 主角背影，面向巨大的环形石质拱门
- 拱门直径超百米，覆满爬藤
- 两侧有瀑布从遗迹边缘流下
- 拱门内部透出冷白色柔光
- 主角极小，平衡感强
- 色调：冷青暗调，史诗感

分镜9（右下）：启程
- 大远景，整个雨崩山谷
- 主角在画面底部中心，走向远方
- 多个发光的几何结构分布在山体各处
- 天空有云层般的能量波动
- 整体氛围：荒芜、孤寂、探索
- 主角占比<3%

【人物要求】
- 完全复刻参考图人物的面部特征
- 服装改为：做旧的红色机甲护甲，表面有划痕、掉漆、泥土
- 背部搭载双剑（金属剑柄配红黑装饰）
- 面部有伤痕和泥土痕迹
- 整体呈现"战后坠落"的疲惫感

【影调参数（严格复刻废土风格）】
- 色温：冷绿/冷青色，偏暗
- 对比度：高对比度，S型曲线
- 饱和度：低饱和度（40%-60%），去掉高饱和荧光色
- 亮度：整体压暗，厚重感
- 色彩映射：高光冷白，中间调冷绿，阴影深青
- 科幻元素：金色（星际结构）+ 冷白（遗迹内部光）
- 质感：明显胶片颗粒感，中等锐化，空气感
- 暗角：20%-30%，强化厚重感

【构图要求】
- 大场景中人物占比极小（<5%-10%）
- 突出"人在宏大废土中的渺小感"
- 增加前景植被遮挡，营造沉浸感
- 低角度俯拍、背影、仰望等多样化构图
- 每个分镜都是电影级画质

【氛围】
- 荒芜、孤寂的废土感
- 后启示录的沉重感
- 探索未知世界的敬畏感
- 去掉轻松的户外探险感
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "方案A_完全废土设定.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成方案A：完全复刻废土设定...")
    
    response = requests.post(
        f"{BASE_URL}/images/generations",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-image-2",
            "prompt": prompt,
            "n": 1,
            "size": "2752x2304"
        },
        timeout=300
    )
    
    result = response.json()
    
    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]
        
        if "b64_json" in image_data:
            img_data = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_data)
            print(f"✅ 方案A已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"✅ 方案A已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def generate_plan_b():
    """方案B：废土风格融入雨崩"""
    
    prompt = """
【重要指令】
参考附件中的人物形象，完全复刻人物面部特征，生成一张包含9个分镜头的九宫格故事板图片。

【核心设定：雨崩废土化】
这是云南雨崩的后启示录废土世界，主角穿着徒步装备，探索被时间侵蚀的雨崩，整个世界呈现荒芜、孤寂的废土感。

【九宫格布局】
3行3列，共9个分镜，从左到右、从上到下，每个分镜之间有细线分隔。

【9个分镜内容】

分镜1（左上）：苏醒
- 俯视角度，主角躺在杜鹃花丛中
- 穿着磨损的深灰色冲锋衣，表面有泥土、划痕
- 面部有伤痕，迷茫地睁开眼睛
- 前景：枯萎的杜鹃花、灰绿色草丛
- 背景：透过枯萎的针叶林可见灰暗的雪山
- 色调：冷绿暗调，低饱和，荒芜感

分镜2（中上）：手部
- 手部特写
- 手指沾满泥土、划痕
- 按在枯萎的苔藓和泥土中
- 侧光打亮，质感粗糙

分镜3（右上）：起身
- 主角挣扎起身，坐在枯草丛中
- 冲锋衣磨损、陈旧
- 低头看自己的手
- 周围是枯萎的森林和灰绿色苔藓
- 色调：冷青暗调，高对比度

分镜4（左中）：前行
- 主角背影，穿过枯萎的森林
- 背包破旧，挂着破烂的布条
- 周围树干巨大，覆满枯萎的苔藓
- 远处雾气弥漫，灰暗
- 构图：人物占比<10%

分镜5（中中）：废弃村落
- 主角站在雨崩村的废弃藏式木屋前
- 木屋破败，屋顶塌陷，覆满枯萎植被
- 经幡破烂，在风中飘动
- 主角在画面底部中心，极小比例（<5%）
- 丁达尔光从破败的木屋缝隙照入
- 色调：冷绿暗调，厚重感

分镜6（右中）：仰望
- 低角度仰拍，主角仰望天空
- 天空中横跨巨大的灰白色几何结构（类似远古观测站）
- 结构表面有微弱冷白色光点
- 云层穿插在结构之间
- 主角占比极小，结构占据天空大部分
- 色调：冷绿暗调+冷白对比

分镜7（左下）：冰湖
- 主角站在干涸的冰湖边
- 湖面龟裂，有几何图案的裂缝
- 湖中心有巨大的石碑，表面刻有模糊的符文
- 周围岩石覆满枯萎苔藓
- 主角占比<5%

分镜8（中下）：神瀑
- 主角背影，面向神瀑
- 瀑布水流减少，露出背后的岩层结构
- 岩层呈现几何纹理
- 瀑布水汽形成灰白色雾气
- 主角极小，平衡感强
- 色调：冷青暗调，史诗感

分镜9（右下）：启程
- 大远景，整个雨崩山谷
- 主角在画面底部中心，走向远方
- 雪山、森林、村落都呈现荒芜、灰暗的废土感
- 天空灰暗，有云层般的能量波动
- 整体氛围：荒芜、孤寂、探索
- 主角占比<3%

【人物要求】
- 完全复刻参考图人物的面部特征
- 服装：磨损的深灰色冲锋衣，表面有泥土、划痕
- 背包破旧，挂着破烂的布条
- 面部有伤痕和泥土痕迹
- 整体呈现"在废土中挣扎求生"的疲惫感

【影调参数（严格复刻废土风格）】
- 色温：冷绿/冷青色，偏暗
- 对比度：高对比度，S型曲线
- 饱和度：低饱和度（40%-60%），去掉高饱和色
- 亮度：整体压暗，厚重感
- 色彩映射：高光冷白，中间调冷绿，阴影深青
- 科幻元素：冷白色（远古结构）
- 质感：明显胶片颗粒感，中等锐化，空气感
- 暗角：20%-30%，强化厚重感

【构图要求】
- 大场景中人物占比极小（<5%-10%）
- 突出"人在宏大废土中的渺小感"
- 增加前景枯萎植被遮挡，营造沉浸感
- 低角度俯拍、背影、仰望等多样化构图
- 每个分镜都是电影级画质

【氛围】
- 荒芜、孤寂的废土感
- 后启示录的沉重感
- 探索未知世界的敬畏感
- 整个雨崩都被"时间侵蚀"的废土化
"""

    output_path = Path.home() / "Desktop" / "视频复刻" / "方案B_雨崩废土化.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("🎨 正在生成方案B：雨崩废土化...")
    
    response = requests.post(
        f"{BASE_URL}/images/generations",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-image-2",
            "prompt": prompt,
            "n": 1,
            "size": "2752x2304"
        },
        timeout=300
    )
    
    result = response.json()
    
    if "data" in result and len(result["data"]) > 0:
        image_data = result["data"][0]
        
        if "b64_json" in image_data:
            img_data = base64.b64decode(image_data["b64_json"])
            with open(output_path, "wb") as f:
                f.write(img_data)
            print(f"✅ 方案B已保存: {output_path}")
            return output_path
        elif "url" in image_data:
            img_response = requests.get(image_data["url"], timeout=30)
            with open(output_path, "wb") as f:
                f.write(img_response.content)
            print(f"✅ 方案B已保存: {output_path}")
            return output_path
    
    print(f"❌ 生成失败: {result}")
    return None


def main():
    # 生成方案A
    print("\n" + "="*60)
    print("【方案A：完全复刻废土设定】")
    print("红色机甲 + 文明遗迹 + 雨崩场景")
    print("="*60 + "\n")
    plan_a = generate_plan_a()
    
    # 生成方案B
    print("\n" + "="*60)
    print("【方案B：雨崩废土化】")
    print("徒步装备 + 废土化雨崩 + 侵蚀感")
    print("="*60 + "\n")
    plan_b = generate_plan_b()
    
    print("\n" + "="*60)
    print("【生成完成】")
    print("="*60)
    if plan_a:
        print(f"✅ 方案A: {plan_a}")
    if plan_b:
        print(f"✅ 方案B: {plan_b}")


if __name__ == "__main__":
    main()
