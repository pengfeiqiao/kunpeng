# 普通对话子代理冒烟记录

## 场景

普通对话收到“写 30 秒剧本，完成分镜，并用子代理并行生成 2 张分镜图”。本地集成冒烟使用无扣费生成替身，验证真实协调器边界、并发、事件、产物收集和付费幂等；不会触发线上计费。

## 工具序列

1. 主代理完成剧本与分镜规划。
2. 同一轮发出两个 `agent_delegate` 调用，分别交接分镜 A、分镜 B 的任务和已确认上下文。
3. 两个子代理使用 `smoke-30s-film/sub-1`、`smoke-30s-film/sub-2` 独立运行，并行调用 `image_generate`。
4. 每个子代理回传 `start -> tool_start -> tool_end -> terminal(completed)`；父执行链收到两个嵌套终态。
5. 产物清单回传 `storyboard-A.png`、`storyboard-B.png`。
6. 用同一父 run、同一参数再次提交分镜 A，付费幂等闸拒绝重复执行。

## 验收结果

- 峰值并行子代理：2。
- 子代理终态：2 个 completed，无悬挂状态。
- 共享付费账本：重复调用被阻止。
- 运行结束后 active child 数量：0。
- 本冒烟可由 `node --test src/lib/agent/subagentRunner.test.ts` 复现；完整结果随 `npm run test:harness` 一并验证。
