# Agent Note：真实可读的 ClawDSH 记录

Status: implemented

[English](2026-08-16-truthful-clawdsh-records.md) | 中文

## 问题

最初的原生「ClawDSH 记录」视图直接展示 package 术语，把同一轮的 Prompt contribution 重复显示为多张卡片，并把事件序号、hash 与内部 kind 放在主要阅读路径。旧 Session 只有 `started` 而没有匹配结果时，它仍告诉用户操作正在运行。Memory 写入和更新记录还会把任何成功工具结果当作真实变更，因此完全重复、内容已是目标值，或没有找到待更新事实时，也可能显示为实际写入或更新。

History projector 只用 `callId` 匹配工具调用与结果，但该身份可以在不同 turn 或 step 重复使用。Automation lifecycle 只在浏览器分页之后折叠，因此终止记录到达时，同一次运行可能重复或在页间移动。Timestamp/id cursor 没有绑定结果 snapshot，live Session 变化时可能跨页跳过或重复记录。当 history 或 sidecar 不可用时，空状态文案还可能错误推断某项能力没有被使用。

## 决策

Package projector 用 `(turn, step, callId)` 匹配支持的工具。完成的 Memory 结果只根据包自有的精确成功文案派生可选封闭 outcome：写入是 `stored` 或 `already-stored`，更新是 `updated`、`forgotten`、`already-current` 或 `not-found`。记录绝不保留事实、query、path、任意结果或错误。没有 outcome 的旧记录仍然有效，显示为中性的已完成请求。没有匹配结果的调用显示为「未记录完成结果」，不宣称工作仍在运行。

同一 rule occurrence 的 Automation `started` 与终止记录在 Host 排序和分页前折叠。终止记录提供可见状态和真实终止时间。终止记录重复或 lifecycle 含义不明确时，页面会标记为 degraded，不会静默宣称确定结果。

Version-1 cursor 除 Session、categories、order、timestamp 与 id 外，还绑定完整筛选记录 snapshot 的 SHA-256 digest。用户分页时记录发生变化，下一个请求会返回已有 `cursor-mismatch` 类别，浏览器则提供从第一页重新读取。该增强不改变 RPC method 或公开 protocol version。

浏览器呈现「身份与上下文、记忆、外部消息、技能、定时任务」五个用户概念。同一 Session sequence 的 Prompt contribution 合并为一张上下文准备卡。每项操作都有中文说明，区分准备与执行、真实变更与无修改结果。内部 kind、事件序号、digest 与来源字段收在默认折叠的「技术详情」中。

Conversation Slot 的公开 Session snapshot 提供最新完成回合的 sequence。新回合完成后重新读取第一页；Session 变更与卸载会中止旧请求。Sidecar-only 事实可能在标准 turn event 后到达，因此页面始终提供「重新读取」。来源缺失或 degraded 时，空结果改为「没有可显示的已选记录」；UI 不会推断某项能力没有被使用。

## 考虑过的替代方案

**显示原始 Activity 记录并解释字段。** 否决：产品视图用于解释行为，原始事件检查已经由相邻 Trajectory 标签拥有。内部字段保留为折叠诊断。

**公开 Memory 事实正文使结果更易理解。** 否决：Activity 是限制隐私的观测 projection。权威事实可以通过 Memory 工具和 Markdown store 读取；复制到 sidecar 或 UI response 会扩大敏感数据保留范围。

**保留 timestamp/id 分页并接受 live drift。** 否决：静默遗漏和重复会使解释性记录失去可信度。Snapshot 变化时显式从第一页重开，行为有界且可见。

**持续轮询 Activity 变化。** 否决：chunk 与 sidecar 写入可以频繁发生，Activity 也没有公开 push seam。完成回合刷新加显式重新读取，能覆盖已支持的证据，不产生后台请求抖动。

## 影响

记录视图现在用用户语言回答 ClawDSH 准备或尝试了什么，并在保留证据不能确立结果时明确说明。它不重建隐藏内容，仍然不是权威记录：Memory 文件、Session event、渠道 receipt 与 Automation session 继续拥有业务状态。

Memory 结果识别有意依赖包自有的精确成功文案。未来修改该文案时，必须在同一变更中更新 projector；否则记录会安全回退为中性 outcome，不会伪造变更。在最后完成回合之后到达的 sidecar-only event 依赖可见的手动重新读取操作。

## 验证

Activity 测试覆盖跨 step 重用 call id、损坏配对、所有 Memory 变更 outcome、缺少 outcome 的旧记录、Automation 折叠与排序、按升序或降序分页期间的 lifecycle 变化、snapshot cursor mismatch、privacy allowlist 与 degraded source。浏览器测试覆盖合并上下文、面向人的 Memory 与 Automation card、折叠技术详情、完成回合刷新、手动重新读取、Session 取消、分页重开与感知来源的空状态。正常 profile 验收会执行真实 Memory 写入与跨 Session 召回，然后检查产生的「ClawDSH 记录」卡片。
