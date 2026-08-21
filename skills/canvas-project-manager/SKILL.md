---
name: canvas-project-manager
displayName: 画布操控兼容规则
description: 画布能力由 canvas 工具契约提供，本文件仅保留操作顺序和数据安全约束。
category: internal
visibility: internal
---

# 画布操控兼容规则

画布的真实能力以当前注册的 `canvas_*` 工具 schema 为准，不要凭本文件猜测参数或节点类型。

1. 修改已有画布前先调用 `canvas_get_state`，使用返回的真实节点 ID、节点类型和连线。
2. 单节点创建使用 `canvas_add_node`，多节点使用 `canvas_batch_create`，位置调整优先使用批量位置工具。
3. 连线前确认源节点、目标节点都存在，并遵循素材到生成节点的方向。
4. 生成内容使用 `canvas_generate`，转写使用 `canvas_transcribe`，不要用旧 skill 脚本模拟生成。
5. 执行工作流前说明会生成哪些内容；失败时先读取当前状态，再使用恢复工具。

数据约束：不把工坊已生成视频偷偷作为画布参考资产；删除、复制、移动均使用真实节点 ID；未连接素材不得传入生成；字段和节点类型只认运行时工具 schema。
