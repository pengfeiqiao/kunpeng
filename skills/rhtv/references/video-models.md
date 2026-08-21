# Video Model Selection

**Whenever** the user wants ANY video (text-to-video OR image-to-video), you MUST show this menu and WAIT:

> 好的！先帮你选个最合适的视频模型～
>
> 1. 🚀 **全能视频V3.1 Fast** — 我最推荐的！又快效果又好，性价比之王
> 2. 🔥 **全能视频X** — Grok 驱动，画面想象力超强，创意天花板
> 3. 🎯 **可灵 v3.0 Pro** — 运动特别自然，拍人物选它准没错
> 4. 🎬 **全能视频V3.1 Pro** — 电影感拉满，适合风景大片
> 5. ✨ **Vidu Q3 Pro** — 风格化独特，适合创意类短片
> 6. ⭐ **全能视频S** — Sora 同款引擎效果好，但最近模型负载比较高，可能要多等一会儿
> 7. 🌊 **海螺 Hailuo** — 速度快画面细腻，适合创意类内容
> 8. 🌱 **Seedance 2.0** — 效果超赞！最长15秒+自动配音+支持真人，最高4K，价格偏高
> 9. 💰 **Seedance 2.0 Mini** — Seedance 2.0 的低价版！0.3毛/秒，效果接近，性价比超高
> 10. 🎥 **MiniMax H3** — 2K 多模态视频，支持图片、视频和音频参考，5-15 秒
>
> 说个数字就行～ 不选的话我默认用 🚀全能视频V3.1 Fast 哦！

**⚠️ STRICT RULES — violation will cause bad user experience:**
1. **Copy-paste** the menu above EXACTLY as-is. Do NOT rewrite, rephrase, rename, or reorder it.
2. **Do NOT invent your own model list** — NEVER pick models from capabilities.json or endpoint names.
3. **Do NOT use endpoint names as display names** — users must see "全能视频V3.1 Fast", NOT "rhart-video-v3.1-fast" or "Veo 3.1" or "Wan-2.6".
4. **Do NOT add models** not in this list (e.g. "万相" is NOT a menu option — it's only used when user explicitly asks for it).
5. **Do NOT rename "Seedance 2.0"** — never call it "Sparkvideo", "超能视频", or any other alias.

**BAD example (NEVER do this):**
> 1. 万相 2.6 🌟 — 画质极高  ← ❌ WRONG: 万相 is not in the menu
> 2. 可灵 Kling 3.0 🚀  ← ❌ WRONG: should be "可灵 v3.0 Pro"
> 3. Seedance 2.0 (Sparkvideo 2.0) ⚡  ← ❌ WRONG: never show "Sparkvideo"

**GOOD example: copy the menu exactly as defined above.**

After user replies, map choice → endpoint:

**Text-to-video** (no image):
| # | Endpoint |
|---|----------|
| 1 (default) | `rhart-video-v3.1-fast/text-to-video` |
| 2 | `rhart-video-g/text-to-video` |
| 3 | `kling-v3.0-pro/text-to-video` |
| 4 | `rhart-video-v3.1-pro/text-to-video` |
| 5 | `vidu/text-to-video-q3-pro` |
| 6 | `rhart-video-s/text-to-video` |
| 7 | `minimax/hailuo-02/t2v-pro` |
| 8 | `rhart-video/sparkvideo-2.0/text-to-video` |
| 9 | `rhart-video/sparkvideo-2.0-mini/text-to-video` |
| 10 | `minimax/hailuo-h3/multimodal-to-video` |

**Image-to-video** (user has image):
| # | Endpoint |
|---|----------|
| 1 (default) | `rhart-video-v3.1-fast/image-to-video` |
| 2 | `rhart-video-g/image-to-video` |
| 3 | `kling-v3.0-pro/image-to-video` |
| 4 | `rhart-video-v3.1-pro/image-to-video` |
| 5 | `vidu/image-to-video-q3-pro` |
| 6 | `rhart-video-s/image-to-video` |
| 7 | `minimax/hailuo-2.3-fast/image-to-video` |
| 8 | `rhart-video/sparkvideo-2.0/image-to-video` |
| 9 | `rhart-video/sparkvideo-2.0-mini/image-to-video` |
| 10 | `minimax/hailuo-h3/multimodal-to-video` |

## Matching Rules

- Number 1-10 → use that model
- Partial name ("可灵", "海螺", "全能", "万相", "Grok", "Seedance", "种子") → match
- "Mini" / "mini" / "低价" → choice 9
- "MiniMax" / "H3" / "海螺 H3" → choice 10
- "随便" / "你选" / "默认" → choice 1
- "最快的" / "便宜的" → choice 1 (Fast) or 9 (Mini, if user wants Seedance quality at low price)
- "万相" → use `alibaba/wan-2.6/text-to-video` or `alibaba/wan-2.6/image-to-video-flash`
- "效果最好的" / "创意最好的" → choice 2 (全能X) or 3 (可灵) or 8 (Seedance 2.0)
- "最长的" / "15秒" / "长视频" / "自动配音" / "4K" → recommend choice 8 (Seedance 2.0)
- "多模态" / "图片+视频" → use multimodal endpoint: `rhart-video/sparkvideo-2.0/multimodal-video`
- Real people in image → recommend choice 3 (可灵) or 8 (Seedance 2.0, also supports real people)

Skip menu ONLY if: user named a specific model, or said "跟上次一样" / "再来一个".

## After Model Is Chosen

**Before running the script**, ALWAYS notify the user first:
> "好嘞，开始用 XX模型 生成视频啦！一般需要几分钟，请稍等～ 🎬"

This is critical — video generation takes 1-5 minutes and users need to know the task has started.

Confirm the choice warmly, then ask for missing info if needed:
> "好嘞，用可灵 v3.0 Pro！视频时长要多久？默认 5 秒，也可以选 10 秒～"

Smart defaults (use these if user doesn't specify):
- Duration: 5s for text-to-video, 5s for image-to-video
- Aspect ratio: 16:9 (landscape); if user's image is portrait → use 9:16

**Seedance 2.0 special handling (choice 8):**
- **⚠️ 必须用 kuaizi.py，不要用 runninghub.py！**
- 调用方式：`python3 ~/.kunpeng/skills/rhtv/scripts/kuaizi.py --prompt "..." --mode pro -o /tmp/kunpeng/rh-output/seedance_$(date +%s).mp4`
- 有参考图：加 `--image /path/to/ref.png`（可重复，最多 9 张）
- 有参考视频：加 `--video /path/to/ref.mp4`（可重复，最多 3 个）
- 有参考音频：加 `--audio /path/to/ref.mp3`（可重复，最多 3 段）
- When user picks 8, warmly mention: "Seedance 2.0 效果超棒！支持最长 15 秒、自动配音、最高 4K！要多长？默认 5 秒"
- Supports real people (auto-whitelist built in). Good for both real people and animation/landscape.
- Resolution options: 480p / 720p / 1080p / 2k / 4k. Default 720p. `--resolution 1080p` or `--resolution 4k`
- Duration range: 4-15 seconds. `--duration 5`
- Disable auto audio: `--no-generate-audio`
- Aspect ratio: `--ratio 16:9` (default) / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive
- Chain super-resolution: `--super-resolution 4k`

**Seedance 2.0 Mini special handling (choice 9):**
- **⚠️ 必须用 kuaizi.py，不要用 runninghub.py！**
- 调用方式同上，加 `--mode mini`：`python3 ~/.kunpeng/skills/rhtv/scripts/kuaizi.py --prompt "..." --mode mini -o /tmp/kunpeng/rh-output/seedance_$(date +%s).mp4`
- When user picks 9, warmly mention: "Seedance 2.0 Mini 性价比超高！0.3毛/秒，效果接近 2.0，支持最长 15 秒、自动配音！要多长？默认 5 秒"
- Same options as Seedance 2.0, but fast/mini don't support native 1080p
- Duration supports `-1` (auto) in addition to 4-15 seconds

## Prompt Optimization

When the user gives a short/vague prompt, ENHANCE it before sending to the API. Example:
- User says: "甜妹跳舞" → Enhance to: "A sweet young woman dancing gracefully in a neon-lit city street at night, dynamic camera movement, cinematic lighting, MV style, 4K"
- User says: "猫在花园" → Enhance to: "An orange tabby cat playing in a sunlit garden with colorful flowers, shallow depth of field, warm afternoon light"

Always write prompts in **English** for best model results, even if the user speaks Chinese.

## Video Failure Retry

If a video model fails (overloaded, timeout, error), do NOT just give up. Tell the user warmly and offer to retry with a different model:
> "哎呀，全能视频S 那边服务器忙不过来了～ 要不要我换 🚀万相2.6 帮你重新生成？一般不会失败的！"

If the user agrees (or says "好"/"换一个"/"试试"), immediately retry with the suggested model. Default fallback order: 全能视频V3.1 Fast → 可灵 → 海螺.
