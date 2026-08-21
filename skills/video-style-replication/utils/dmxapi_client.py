"""
DMXAPI 统一客户端
支持豆包多模态分析（视频直传/帧分析）和 GPT-Image-2 生图
"""
import os
import base64
import requests
from pathlib import Path
import json


class DMXAPIClient:
    """统一的 DMXAPI 客户端，支持视频直传和帧分析"""
    
    def __init__(self):
        self.api_key = os.environ.get("DMXAPI_KEY")
        if not self.api_key:
            raise ValueError("❌ DMXAPI_KEY 未配置，请在 ~/.zshrc 中设置")
        self.base_url = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
    
    def analyze_video_direct(self, video_path, prompt):
        """
        直接分析视频（豆包向量化API）
        适用于小视频（<50M）
        """
        # 读取视频文件并转base64
        with open(video_path, "rb") as f:
            video_base64 = base64.b64encode(f.read()).decode()
        
        # 构建多模态消息（包含视频）
        content = [
            {"type": "text", "text": prompt},
            {
                "type": "video_url",
                "video_url": {
                    "url": f"data:video/mp4;base64,{video_base64}"
                }
            }
        ]
        
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "doubao-seed-2-0-pro-260215",
                "messages": [{"role": "user", "content": content}]
            },
            timeout=300  # 视频分析可能需要更长时间
        )
        
        return response.json()
    
    def analyze_frames(self, frames_dir, prompt):
        """
        分析视频帧（豆包多模态）
        适用于大视频（>50M）
        """
        # 构建多模态消息
        content = [{"type": "text", "text": prompt}]
        
        # 读取所有帧图片
        frame_count = 0
        for img_path in sorted(Path(frames_dir).glob("*.jpg")):
            with open(img_path, "rb") as f:
                img_base64 = base64.b64encode(f.read()).decode()
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{img_base64}"
                    }
                })
                frame_count += 1
        
        print(f"📸 上传 {frame_count} 个关键帧进行分析...")
        
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "doubao-seed-2-0-pro-260215",
                "messages": [{"role": "user", "content": content}]
            },
            timeout=90
        )
        
        return response.json()
    
    def generate_prompts(self, style_template, scene):
        """生成AI视频提示词（豆包）"""
        prompt = f"""
基于以下影调风格模板，为场景"{scene}"生成AI视频提示词。

影调模板：
{json.dumps(style_template, ensure_ascii=False, indent=2)}

请生成：
1. 正面提示词（支持Pika/Runway/即梦）
   - 包含场景描述、影调参数、运镜、氛围
   - 长度控制在100-150词
   
2. 负面提示词
   - 列出需要避免的元素
   
3. 运镜建议（3-5个具体运镜方案）
4. 光影时机建议（时间段+光位）

输出格式：JSON
{{
  "positive_prompt": "...",
  "negative_prompt": "...",
  "camera_suggestions": [...],
  "timing_suggestions": "..."
}}
"""
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "doubao-seed-2-0-pro-260215",
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=60
        )
        
        return response.json()
    
    def generate_image(self, prompt, output_path="generated_image.jpg", size="1024x1024"):
        """基于提示词生成验证图（GPT-Image-2）"""
        response = requests.post(
            f"{self.base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-image-2",
                "prompt": prompt,
                "n": 1,
                "size": size
            },
            timeout=300
        )

        result = response.json()
        if "data" in result and len(result["data"]) > 0:
            image_data = result["data"][0]

            # 处理 base64 数据
            if "b64_json" in image_data:
                import base64
                with open(output_path, "wb") as f:
                    f.write(base64.b64decode(image_data["b64_json"]))
                return output_path
            elif "url" in image_data:
                # 下载图片
                img_response = requests.get(image_data["url"], timeout=60)
                with open(output_path, "wb") as f:
                    f.write(img_response.content)
                return output_path
            else:
                print(f"❌ 未找到图片数据，返回键: {image_data.keys()}")
                return None
        else:
            print(f"❌ 生图失败: {result}")
            return None
