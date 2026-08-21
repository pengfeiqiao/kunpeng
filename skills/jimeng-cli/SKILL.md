---
name: jimeng-cli
description: Use when an agent needs Dreamina（即梦） login, sessions, task history, Seedream 5.0 Pro, or Seedance 2.5 image/video generation through the dreamina CLI.
visibility: library
---

# Dreamina CLI

## Mandatory confirmation before paid generation

Before running any command that consumes credits (`text2image`, `text2video`, `image2image`, `image2video`, `multimodal2video`, `multiframe2video`, `frames2video`, or `image_upscale`), show the user the intended model, duration/resolution, input count, and complete command, then wait for explicit confirmation. Help, `user_credit`, `query_result`, and `list_task` are read-only and do not require confirmation.

Use this skill when you need Dreamina（即梦） image or video generation, login, session management, or task history work through `dreamina`.

即梦 is the Chinese product name of Dreamina. If the user says 即梦, treat it as Dreamina and use this skill.

This skill is intentionally short. Detailed flags and supported values belong to the CLI itself, so always treat `dreamina -h` and `dreamina <subcommand> -h` as the primary reference.

## What this tool is for

`dreamina` is the local CLI entrypoint for all currently exposed Dreamina（即梦） image and video generation workflows, plus the account/session operations around them.

Use it for:

- checking or reusing an existing Dreamina login session
- checking account credit
- managing sessions with `dreamina session`
- clearing the local OAuth login state with `dreamina logout`
- submitting image generation tasks
- submitting video generation tasks
- querying async task results and downloading result media
- reviewing saved task history

## Default workflow

When using this CLI as an agent:

1. Start with `dreamina -h`.
2. Before using any command for real, run `dreamina <subcommand> -h`.
3. Reuse the current login state unless the user explicitly asks you to `login`, `relogin`, `logout`, or finish a headless login with `checklogin`.
4. When login is required, run `dreamina login` or `dreamina relogin`. The CLI uses OAuth Device Flow and prints `verification_uri`, `user_code`, and `device_code`.
5. Default login waits for authorization to complete. With `--headless`, the CLI prints the device-flow material and exits; then use `dreamina login checklogin --device_code=<device_code>` to finish the login later.
6. Be explicit about whether you are only reading help, submitting a real task, or querying an existing task.
7. Warn the user before running commands that may consume credits.

## Login completion: mandatory user-visible confirmation

`dreamina login` / `dreamina relogin` prints OAuth Device Flow instructions and then waits for authorization. When the command finishes successfully, tell the user explicitly that login succeeded or the local OAuth state was reused.

- **Do not** wait for the user to ask “登录好了吗”.
- **Do not** stop after only sending the device code: keep the login command running, read stdout to the end, then confirm success/reuse/failure.
- **Failure** must still be reported with the concrete error and the next step.

## Choosing the right command

At a high level:

- Use `user_credit` to check budget.
- Use `session` to create, list, search, rename, or delete sessions; all generator commands accept `--session=<id>` and `0` is the default session.
- Use `query_result` when you already have a `submit_id`; add `--download_dir` when you want the generated media saved locally.
- Use `list_task` to review recent saved tasks, especially when you want to filter by status or task type.
- Use `text2image` for prompt-only image generation, `image2image` for image-guided editing, and `image_upscale` for upscaling.
- Use `text2video` for prompt-only video generation.
- Use `image2video` when one main image is enough.
- Use `frames2video` for first-and-last-frame driven video generation.
- Use `multiframe2video` for Dreamina's fixed-model, image-only intelligent multi-frame flow: multiple images in, one coherent story video out. This command does not expose model selection.
- Use `multimodal2video` for Dreamina's flagship video mode when the task needs all-around references across images, video, and audio, or when a Seedance 2.5 multi-image request needs model selection. If the legacy name `ref2video` appears, trust `dreamina -h` for the current command surface.

For the exact flags and supported combinations, rely on each subcommand's `-h`.

## Model selection rule

Do not hardcode model support from this skill.

If the user specifies a model, always check the relevant subcommand help before running it:

```bash
dreamina <subcommand> -h
```

Use the subcommand help to confirm:

- whether that command exposes model selection
- whether the requested model is supported on that command
- what other constraints apply to that model, such as duration, ratio, resolution, or whether the command supports `model_version` at all

Additional guidance:

- some commands do not expose model selection at all
- runtime availability and queue capacity can change
- if the user does not specify a model, preserve the subcommand's current default instead of overriding it
- if the user expresses a speed or quality preference, inspect the current help and select a model only when that preference requires an explicit choice

## How to judge submit acceptance and terminal success

Do not rely on shell exit code alone.

For async generation commands, `submit_id` plus `gen_status=querying` means only that the submission was accepted. It is not evidence that generation finished successfully.

Treat the task as terminally successful only when `gen_status=success`. If `gen_status=fail`, inspect `fail_reason` and reply proactively with the concrete reason.

Use `--poll=N` on a generation command to wait for up to N seconds for a terminal result. If the command still returns `querying` after that bounded wait:

- save the `submit_id`
- continue with `query_result --submit_id=<id>` until the task reaches `success` or `fail`

## Follow-up pattern for async tasks

After a submit returns `querying` without reaching a terminal result during `--poll=N`:

1. Save the `submit_id`.
2. Use `query_result --submit_id=<id>` for follow-up.
3. Use `list_task` when you want to review saved tasks in bulk.

If you are running a test sweep, keep results in a machine-readable format so you can query the returned `submit_id` values later.

## Important user-facing rules

- Some generation commands are asynchronous; submit and query are separate steps.
- Some models may require a one-time authorization on Dreamina Web.
  If the CLI returns `AigcComplianceConfirmationRequired`, reply proactively: ask them to complete that web-side confirmation first, then retry.
- Do not assume that different commands support the same models, ratios, durations, or resolutions.
  Check each subcommand's `-h` before use.

## Good agent behavior

- Relay OAuth Device Flow instructions exactly enough for the user to complete login.
- Always close the loop when the login command finishes with a user-visible confirmation.
- Prefer small, reviewable batches when running real generation tasks.
- Keep a record of the command, arguments, `submit_id`, and final status for every paid test you run.
- If you are preparing a report, separate:
  - help-only inspection
  - submit-stage validation
  - later async result follow-up
