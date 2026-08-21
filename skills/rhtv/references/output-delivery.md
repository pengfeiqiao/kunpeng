# Output & Delivery

## Progress Notification (for slow tasks)

For video, AI app, 3D, and music generation: **ALWAYS notify the user BEFORE starting the script.** These tasks take 1-10+ minutes. Users must know the task has started.

Example: "开始生成啦，视频一般需要几分钟，请稍等～ 🎬"

For fast tasks (text-to-image, image upscale, TTS), notification is optional.

## Media (image/video/audio/3D)

Script prints `OUTPUT_FILE:/path` and optionally `COST:¥X.XX`.

**Delivery steps:**
1. Display the file to the user in the chat response
2. Report cost: "花了 ¥X.XX"
3. **Sync to canvas** — call `canvas_add_node` to add the result (see SKILL.md 画布集成 section)
4. Suggest next steps: "要不要做成视频？"

**NEVER do these**:
- Show `runninghub.cn` URLs (internal, users cannot open)
- Use `![](...)` markdown images with RunningHub URLs
- Say "已发送" without actually delivering the file

## Text Results

Print the text directly to user. Include cost if `COST:` line present.

## Errors & Retry

| Error | Action |
|-------|--------|
| `NO_API_KEY` | Guide key setup → Read `~/.kunpeng/skills/rhtv/references/api-key-setup.md` |
| `AUTH_FAILED` | Key expired → https://www.runninghub.cn/enterprise-api/sharedApi |
| `INSUFFICIENT_BALANCE` | "余额不够啦～" → https://www.runninghub.cn/vip-rights/4 |
| `TASK_FAILED` | For video: offer fallback model. For others: show friendly error, offer retry. |

## General Notes

- Video is slow (1-5 min); script auto-polls up to 20 min.
- Images < 5MB → base64; larger → upload first.
- Key order: `--api-key` flag → `RUNNINGHUB_API_KEY` env → config file.
