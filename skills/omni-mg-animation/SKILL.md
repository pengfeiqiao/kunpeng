---
name: omni-mg-animation
description: Create paid motion-graphics videos in Kunpeng with MiniMax H3, Omni, or Seedance Mini. Use for MG animation, app showcase MG, talking-head graphic overlays, text-to-video MG explainers, and editor/canvas workflows that may spend credits.
---

# 鲲鹏付费 MG 动画

Use Kunpeng settings instead of hardcoded credentials:
- API keys: Settings -> API Keys -> Omni MG 动画 -> ZexAPI Omni API Key / ZeroFall Omni API Key / APIMart compatible Omni API Key
- Primary route: ZexAPI `https://zexapi.com/v1/videos`, model `omni_flash-10s`, 720p 10s.
- Secondary route: ZeroFall `https://llm.zerofall.top/v1/video/generations`, 720p 10s. Text/image generation uses `omni-flash`; video editing/reference-video generation uses `omni-flash-vref`.
- ZeroFall `omni-flash-vref` contract: pass exactly one `video` URL/path, optional `images` array with 0-5 reference images, `duration: 10`, `aspect_ratio: "landscape" | "portrait"`, and poll `GET /v1/video/generations/{task_id}`. Returned URLs are temporary and must be downloaded immediately.
- Fallback route: legacy APIMart-compatible domains use the APIMart compatible key only after ZexAPI and ZeroFall fail.
- Do not expose base URL routing to the user.
- ZeroFall/Google 400 means the prompt is likely rejected for safety, copyright, or real-person content. Before generation, rewrite risky prompts toward abstract MG, product UI, icons, shapes, dashboards, charts, and non-real-person visual metaphors.

## Editor Gate

When the user asks for MG animation in the editor, first ask only:
`你要网页特效（便宜、可编辑），还是付费 MG 动画（AI 视频生成）？`

Do not ask style in the first round. Do not call Omni plan/generate tools in the first round.

If the user chooses web effects, return to the normal Scene/HTML workflow.

If the user chooses paid MG animation, ask in the second round:
- Engine: `MiniMax H3（推荐，2K，5-15秒）`, `Omni（720p，固定10秒）`, or `Seedance Mini（4-15秒）`. If the user does not choose, default to H3. Never silently use ordinary Seedance 2.0.
- Which curated Omni MG style to use
- `花字类型 / 视频生 MG` or `纯 MG 动画 / 文字生`
- Whether the selected video needs a 10s segment. Do not offer 4s/6s as normal choices.

Only after those answers, call `timeline_omni_mg_plan` with the selected `engine`. Generate only after the user confirms the plan. When generating multiple clips, use `timeline_omni_mg_generate_batch` with `engine` so tasks run in parallel; do not call single-clip generation one by one unless there is only one clip. The old tool names remain for compatibility and do not force Omni.

Engine duration rule:
- MiniMax H3 is the default: 2K, 5-15s.
- Omni: 10s, 720p through ZexAPI/ZeroFall.
- Seedance Mini: 4-15s.
- 4s/6s are narrow fallback-only durations for legacy APIMart/apib.ai when both low-cost 10s routes are unavailable, insufficient, timed out, or failed.
- Never choose 4s/6s merely because a selected clip is short or because it feels cheaper.

## Entrances

Normal chat:
- Text only: turn the copy into one or more 720p MG videos, 10 seconds each by default.
- Video provided: inspect duration. If longer than 10 seconds, use ASR/video understanding and split into suitable 10s descriptions before generation.

Editor:
- No timeline video: analyze the script, propose number of videos, duration, placement, and rough cost.
- Timeline has video: transcribe/read the timeline first, choose segments needing effects, propose the plan, then insert generated videos on video track 2 above the original.

Canvas:
- Use the MG动画 node (`isMgAnimationNode: true`, `modelVersion: "omni-mg-animation"`).
- It can take images, prompt text, and one reference video.
- If the video is too long, ask the user to trim or select a 10-second section.
- The MG prompt polish button must rewrite using the prompt contract below.
- The style library contains curated categories and preview cards. Use one primary style and at most one accent style; the accent may contribute one material or transition trait and must not dilute the primary style.
- The default effect recipe is rich / 2.5D / narrative rhythm / around subject / follow style. Only change it when the user's request gives a clear reason.

Text-heavy clips:
- If the prompt contains many Chinese characters, several exact text cards, subtitles, or text that should appear sequentially, first create a fixed text-layout reference image with GPT-Image-2.
- Feed that image to Omni as a reference image together with the prompt/video. This lowers text-rendering errors.

If the user reviews a generated MG/video result and says the text is still wrong, garbled, inaccurate, or the result is unsatisfactory:
- Treat it as a manual second-pass fallback, not another Omni retry.
- Editor: call `timeline_mg_text_fallback`.
- Canvas or normal chat: call `mg_text_fallback_generate`.
- The fallback flow is fixed: GPT-Image-2 creates a locked text-layout image, then Kuaizi Seedance 2.0 Mini turns that image into video.
- The reference image must prioritize exact text, clear hierarchy, high contrast, and no extra invented labels.

## Prompt Contract

Always use this structure when writing prompts for Omni:

```text
You are a world-class motion-graphics director creating a premium 720p MG animation.
Duration: 10s. Resolution: 720p.

TEXT LOCK - HIGHEST PRIORITY:
- Visible text must be exactly the same as the user-provided wording.
- Do not paraphrase, translate, simplify, add, misspell, or invent text.
- Never generate random Chinese, mojibake, fake UI labels, dense subtitles, or unreadable small text.
- If exact rendering is uncertain, use no text and communicate with icons, symbols, shapes, numbers, arrows, UI objects, charts, and motion metaphors.
- Important Chinese text may appear only as 1-4 large characters or one explicitly quoted short phrase.

SAFETY / ROUTE STABILITY:
- Avoid copyrighted characters, celebrity likenesses, real-person identity transformation, political/sexual/violent/medical claims, and brand misuse unless the user owns the assets.
- For talking-head or real-person video edits, preserve the person and avoid identity changes, face replacement, celebrity comparison, or anything that implies impersonation.
- If a concept may trigger Google 400 rejection, express it as abstract motion graphics, UI metaphors, icons, charts, non-human objects, and generic product visuals.

SELECTED STYLE: ...
Style language: ...
Design direction: ...

MOTION RECIPE:
- Default to 5-9 active elements introduced in controlled groups.
- Define one hero element, 2-3 supporting element families, one connective motion language, and one recurring motif.
- Use layered 2.5D space by default, with foreground accents, a hero plane, and supporting depth.
- Richness must come from meaningful relationships, not clutter.

TEN-SECOND CHOREOGRAPHY:
- 0.0-2.0s HOOK: one hero idea plus at least two supporting cues.
- 2.0-7.0s DEVELOPMENT: two coordinated element groups demonstrate cause/effect through handoff, orbit, connection, assembly, comparison, propagation, or transformation.
- 7.0-10.0s PAYOFF: all elements resolve into one clear result, conclusion, or hero composition.

MOTION QUALITY:
- Avoid PPT-like page switching and single-object loops.
- Use designed camera movement, masks, parallax, curved paths, staggered rhythm, precise alignment, and one clear focal point at every moment.
- No random cards, filler particles, unrelated stickers, or decorative clutter.

REFERENCE VIDEO PROTECTION:
- Preserve identity, face, facial features, hairstyle, expression, lip sync, body motion, and voice exactly.
- Do not cover eyes, face, mouth, hands, or important props.
- Keep original background largely unchanged unless requested.

USER REQUIREMENT / EXACT COPY:
...
```

## Human Review And Repair

Do not automatically score, regenerate, or run a self-review loop after generation. Present the result and let the user judge it.

When the user gives feedback, repair the identified problem instead of appending generic adjectives:
- "太简单 / 没动效": add two related element families and define how they hand off, react, or aggregate.
- "太乱": keep the information, reduce simultaneous motion, and stagger groups across the 10-second beat sheet.
- "人物变了 / 脸变了": strengthen identity and face locks; move all graphics into safe zones.
- "背景变了": use localized overlay editing and preserve the original environment.
- "不好看 / 像 PPT": choose a different visual system and rewrite composition, material, and motion; do not merely add "高级感".
- "文字错 / 乱码": use the GPT-Image-2 fixed text plate, then the configured fallback path.
- Google/ZeroFall 400: rewrite copyrighted, real-person, or sensitive content as abstract MG/UI/icon metaphors; do not blind-retry the same prompt.

## Curated Styles

Use enough range, but keep every style visually specific:

App/product:
- `app-premium-3d` 高级应用展示: diagonal rounded app tiles, studio lighting, keynote-level app showcase.
- `app-search-glass` 搜索框产品片: glossy search/input hero object, macro lens, cursor pulse, soft brand light trails.
- `app-grid-icons` 图标矩阵生态: isometric elevated app-tile grid, staggered lift, ripple highlight, selective glow.
- `mobile-ui-tour` 手机界面漫游: hero phone plus supporting screens, swipe trails, tap ripples, screen masks.
- `saas-dashboard` SaaS 仪表盘: widgets, KPI cards, chart builds, calm enterprise hierarchy.
- `ai-workflow` AI 工作流界面: prompt input, model nodes, output cards, automation pipeline.
- `fintech-payment` 支付金融 App: secure cards, transaction flow, lock/check icons, trustworthy motion.
- `ecommerce-product` 电商功能演示: product cards, cart flow, clean conversion funnel.
- `devtool-pipeline` 开发者工具流程: code blocks as abstract panels, deploy pipeline, API nodes.
- `product-launch-stage` 产品发布舞台: hero object, floating feature cards, cinematic reveal.

Brand/tech/editorial:
- `neo-grid-objects` 潮流网格物件: strict grid, loud color band, abstract 3D objects.
- `dark-orbit-tech` 暗场星轨科技: sparse black stage, thin orbital lines, star particles.
- `soft-gradient-title` 柔光手写标题: luminous warm gradient, one exact handwritten phrase.
- `swiss-editorial` 瑞士编辑感: strict grid, huge whitespace, thin rules, one accent color.
- `glass-ai-interface` 玻璃 AI 界面: translucent panels, neural paths, cyan highlights, depth parallax.
- `monochrome-red-accent` 黑白红点强调: monochrome editorial layout with one red emphasis system.
- `black-gold-launch` 黑金发布会: black negative space, gold hairlines, metal glints.
- `liquid-metal-tech` 液态金属科技: chrome ribbons/blobs morphing into icons or cards.
- `microchip-circuit` 芯片电路流: PCB paths, packet pulses, chip modules.
- `spatial-hologram` 空间全息界面: floating translucent panels and spatial depth.

Information design:
- `kinetic-infographic` 高级信息图解: flow/comparison/funnel/stack/timeline/map mechanisms.
- `process-flywheel` 流程飞轮: circular module loop and acceleration.
- `comparison-breakdown` 对比拆解: split panels, before/after cards, replacement actions.
- `timeline-story` 时间轴叙事: milestone path reveal.
- `three-step-method` 三步方法论: three stable visual anchors and step handoff.
- `data-dashboard` 数据仪表盘: counters, chart builds, highlighted insight.
- `system-architecture` 产品架构图: layered service modules and data packets.
- `map-route` 地图路径: abstract map shapes, routes, pins.
- `knowledge-cards` 知识卡片: card deck flips/stacks/expands.
- `numeric-counter` 数字冲击: one exact hero number with kinetic reveal.

Talking-head safe overlays:
- `talking-head-premium` 口播高级包装: safe side/corner graphics, translucent panels, no face obstruction.
- `side-panel-callouts` 侧边悬浮卡片: floating cards and thin connector lines.
- `keyword-icon-bursts` 关键词图形强调: speech-synced icons and one exact keyword.
- `safe-hud-overlay` 轻量科技 HUD: subtle corner HUD, scan arcs, small indicators.
- `captionless-visual` 无字幕视觉包装: icons and diagrams instead of subtitles.
- `exact-chinese-title` 中文锁字标题: exact large Chinese characters only.
- `no-text-icon-story` 无字图形叙事: icons, arrows, diagrams, UI objects, no text except exact numbers.

Collage/handmade:
- `paper-editorial-collage` 报刊拼贴手账: torn paper, sticky notes, tape impacts, hand-drawn arrows.
- `polaroid-tape` 拍立得胶带: photo frames, masking tape, frame shakes.
- `magazine-cutout` 杂志剪贴版式: editorial crops, torn labels, dramatic mask wipes.
- `paper-stage` 纸片舞台: layered paper diorama, folds, pop-up actions.
- `hand-drawn-doodle` 手绘涂鸦解释: marker arrows, circles, underline strokes.
- `riso-print` Riso 印刷: grainy ink, offset colors, bold silhouettes.

Social/3D:
- `creator-pop` 创作者爆款图形: sticker pops, elastic callouts, icon bursts.
- `sticker-bounce` 贴纸弹跳包装: rounded badges, elastic scale, colorful icons.
- `color-block-transition` 潮流色块转场: large geometric wipes and color fields.
- `elastic-icon-system` 弹性图标系统: morphing icons with spring timing.
- `short-video-impact` 短视频开场冲击: fast 0.5s hook and punchy shape hits.
- `isometric-city` 等距城市地图: miniature buildings, roads, pins, route lines.
- `soft-3d-icons` 柔光 3D 图标: satin plastic icons with soft light.
- `miniature-diorama` 微缩产品舞台: tiny scenes and tilt-shift depth.
- `glass-space` 悬浮玻璃空间: glass planes, refraction, depth layers.
- `product-pedestal` 产品陈列台: one hero product/card on a display platform.

## Known Pitfalls

- Do not rely on Omni to render long readable Chinese.
- `.mov` on COS must use `Content-Type: video/mov`.
- APIMart-compatible reference video accepts at most one video.
- Current resolution is only `720p`.
- Some providers may fail by domain/account balance; use the configured fallback chain.
