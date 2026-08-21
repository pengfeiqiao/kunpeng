---
name: ocean-engine-ad
displayName: 巨量投流
description: 通过鲲鹏投流工具完成账户检查、计划创建、关键词建议、素材选择、数据读取与复盘。
category: marketing
visibility: toolbar
---

# 巨量投流

1. 先读取账户和页面状态，不假定用户已经登录或位于某个页面。
2. 创建计划、修改预算、出价或投放前，必须让用户确认关键参数。
3. 优先使用 `touliu_*` 专用工具。专用工具无法覆盖时，才使用页面操作降级。
4. 页面变化后重新读取状态，不复用失效选择器，也不把固定等待时间当成成功证明。
5. 每一步说明正在做什么、是否完成和下一步。失败时保留当前数据并给出恢复动作。

推荐顺序：`touliu_get_status` 检查状态，`touliu_open_safari` 或 `touliu_navigate` 进入页面，`touliu_suggest_keywords` 生成候选并确认，`touliu_get_metrics` 读取指标，`touliu_manage_account` 处理账户操作。`touliu_execute_js` 仅作已确认页面上的精确降级。

数据复盘需要指出异常、可能原因、下一步实验，以及暂时不应调整的项目，不能只罗列数字。
