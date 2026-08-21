# touliu Skill 修复指南

> 基于 2026-06-14 实战验证。所有结论均来自真实测试。

---

## 一、工具状态总览

| 工具 | 状态 | 说明 |
|------|------|------|
| `touliu_get_status` | ⚠️ 部分 | 账户信息正常，projects 为空 |
| `touliu_get_metrics` | ❌ 不存在 | 函数未注册，调用报 Unknown tool |
| `touliu_suggest_keywords` | ✅ | 纯LLM生成，无WebView依赖 |
| `touliu_manage_account` | ⚠️ 部分 | add/switch正常，remove需accountId |
| `touliu_open_safari` | ⚠️ 部分 | data页404，其余正常 |

---

## 二、URL 路由修复（最关键）

### 问题
`touliu_open_safari data` 打开的 URL 是：
```
https://ad.oceanengine.com/superior/data?aadvid={aadvid}
→ 返回 404 Not Found
```

### 修复
改为：
```
https://ad.oceanengine.com/pages/index.html?aadvid={aadvid}
→ 自动跳转到 /promotion/promote-manage/ad?aadvid={aadvid}&uuid=...
→ 页面标题变为"投放管理"
→ 包含完整的项目/单元列表和数据
```

### 完整URL对照表

| 页面 | 旧URL | 新URL |
|------|-------|-------|
| 首页/投放管理 | `/superior/data` ❌ 404 | `/pages/index.html?aadvid={aadvid}` ✅ |
| 创建项目(小ad版) | `/superior/create-project?aadvid={aadvid}&is_create=1&campaign_type=1` ✅ | 不变 |
| 创建项目(完整版) | 同上 | 同上（需登录oceanengine.com主站才显示种草通） |
| 登录 | `business.oceanengine.com/login` ✅ | 不变 |
| 商务平台 | `business.oceanengine.com/site/index` | 不变（自动跳转过来） |

---

## 三、`touliu_get_metrics` 需要实现

当前该函数不存在（调用返回 "Unknown tool"）。实现时需要：

### 流程
```
1. Safari 导航到 https://ad.oceanengine.com/pages/index.html?aadvid={aadvid}
2. 等待页面加载（判断 document.title === "投放管理"）
3. 执行 document.body.innerText 提取原始文本
4. 正则解析表格数据
```

### 数据解析规则

innerText 返回的文本结构如下（以制表符和换行分隔）：
```
单元名称    操作    项目状态    项目预算    单元状态    单元预算    单元出价    项目名称    消耗(元)    展示数    ...
C_自定义精准_预算1000    原生    ID: xxx    编辑    复制    ...    0.32    48    6.67    1    ...
```

解析步骤：
```
1. 按换行符分割 → 得到行数组
2. 找到"单元名称"行 → 表头（确定各列位置）
3. 遍历后续行，找到"总计 N 项"行作为结束标记
4. 每行按制表符分割 → 提取各字段
5. ID 从 "ID: xxxxx" 格式的行中提取（通常紧跟在单元名称后）
```

### 关键字段映射（按表头顺序，注意不同账户可能不同）

| 表头 | 含义 |
|------|------|
| 单元名称 | 第一行是名称，第二行是"原生"标签，第三行是 ID:xxx |
| 项目名称 | 所属项目 |
| 消耗(元) | 当日消耗 |
| 展示数 | 曝光量 |
| 平均千次展现费用(元) | CPM |
| 点击数 | 点击量 |
| 点击率 | CTR |
| 转化数 | 互动转化数 |
| 转化率 | CVR |
| 平均转化成本(元) | CPA |
| 诊断状态 | 不起量/相似挤压/暂无问题 |
| 单元出价 | oCPM出价 |
| 单元预算 | 日预算 |

---

## 四、`touliu_get_status` 需要增强

### 当前返回
```json
{
  "activeAccount": {"name":"雪","aadvid":"1827629301400580"},
  "accounts": [{"name":"雪","aadvid":"1827629301400580","isActive":true}],
  "projects": [],
  "runningTasks": 0
}
```

### 需要增加
```
- webviewReady: 检测 WebView 是否就绪
- isLoggedIn: 检测 Safari 是否已登录（通过 document.title 判断，非404即为登录）
- projects: 从数据页提取项目列表
- accountBalance: 账户余额
- dailyCost: 当日消耗
```

### 登录检测逻辑
```
不是检查 cookie，而是：
1. 导航到 /pages/index.html?aadvid={aadvid}
2. 如果 document.title === "巨量引擎广告投放平台" 或 "投放管理" → 已登录
3. 如果 document.title === "404 Not Found" → URL 错误
4. 如果跳转到登录页 → 未登录
```

---

## 五、Safari + osascript 操作规范（已验证可用）

### 核心原则
- 所有页面操作通过 `osascript → Safari → do JavaScript` 完成
- 不使用 Playwright（其React事件触发不稳定）
- 不使用WebView（URL路由有bug）

### 数据读取模板
```bash
osascript -e "
tell application \"Safari\"
    set rawText to do JavaScript \"document.body.innerText\" in current tab of window 1
    return rawText
end tell"
```

### 页面导航模板
```bash
osascript -e "tell application \"Safari\"" \
  -e "set URL of current tab of window 1 to \"https://ad.oceanengine.com/pages/index.html?aadvid=1827629301400580\"" \
  -e "end tell"
```

### 等待页面加载
```bash
sleep 4  # 等待React SPA渲染完成
```

### 点击元素（React组件）
```bash
# 对于一般按钮/链接
osascript -e "
tell application \"Safari\"
    do JavaScript \"
        var el = document.querySelector('.target-class');
        if (el) { el.click(); }
    \" in current tab of window 1
end tell"
```

### 输入文本
```bash
osascript -e "
tell application \"Safari\"
    do JavaScript \"
        var input = document.querySelector('input[placeholder=\\\"请输入\\\"]');
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, '要输入的内容');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    \" in current tab of window 1
end tell"
```

---

## 六、已验证可用的完整操作流程

### 流程A：查看数据
```
1. touliu_open_safari → custom → https://ad.oceanengine.com/pages/index.html?aadvid={aadvid}
2. sleep 4
3. osascript → document.body.innerText
4. 正则解析 → 提取账户总览 + 单元列表
```

### 流程B：创建项目（完整版，含种草通）
```
前提：已在 oceanengine.com 完整登录（不是business子站）
1. touliu_open_safari → create-project
2. sleep 4
3. 选择营销目的 → 点击"内容营销"
4. 处理弹窗（如有"切换营销目的将会清空"→ 点确认）
5. 点击"种草通"卡片 → 点SPAN父容器
6. 选择优化目标 → 点击"互动"
7. 设置搜索系数 → 点击"立即采纳" DIV
8. 填写项目名称、预算
9. 保存
```

### 流程C：添加行为兴趣关键词（Safari方案）
```
1. 打开项目编辑页
2. 点击"行为兴趣" → "自定义"
3. 在"请输入行为类目词或关键词"输入框键入词
4. 点击"查关键词"按钮
5. 等待搜索结果出现
6. 点击搜索结果中的checkbox勾选
7. 重复3-6添加更多词
8. 保存
```

### 流程D：创建单元（Playwright方案，已验证可靠）
```
1. 打开创建单元页
2. 在drawer中选择视频（需MouseEvent序列：mousedown→mouseup→click）
3. 填写预算、出价、单元名称
4. 输入5个不同标题
5. 保存
```

---

## 七、已攻克的技术难点

| 难点 | 原因 | 解法 |
|------|------|------|
| React卡片不响应click | React事件代理，DOM click无效 | 点击textContent匹配的SPAN父容器 |
| 种草通在小ad版消失 | 小ad版仅部分加载组件 | 必须先登录 oceanengine.com 主站 |
| 视频drawer不选中 | 需MouseEvent全序列 | mousedown→mouseup→click + 等enabled |
| 行为兴趣搜索框不生效 | 需要nativeInputValueSetter | 用getOwnPropertyDescriptor绕过React |
| "查关键词"按钮 | 不同于"查词"按钮 | 精确匹配textContent |
| 弹窗确认按钮 | React事件代理 | find button by textContent + click |

---

## 八、待修复清单（按优先级）

1. **P0**：`touliu_open_safari data` URL → 改为 `/pages/index.html`
2. **P0**：实现 `touliu_get_metrics` 函数
3. **P1**：`touliu_get_status` 增加 projects/balance/dailyCost
4. **P1**：`touliu_get_status` 增加登录检测（基于页面title非404）
5. **P2**：`touliu_manage_account remove` 支持按name删除
6. **P2**：增加 `touliu_navigate` 函数（导航到指定页面+等待加载）
7. **P2**：增加 `touliu_execute_js` 函数（执行任意JS并返回结果）
