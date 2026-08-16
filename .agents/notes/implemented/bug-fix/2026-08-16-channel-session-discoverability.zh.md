# Agent Note: 渠道 Session 可发现性保留已记录的工作区身份

Status: implemented

[English](2026-08-16-channel-session-discoverability.md) | 中文

## 问题

[OpenClaw 渠道平面桥接](../architecture/2026-08-15-openclaw-channel-plane-bridge.md)会为每个已准入的路由 generation 创建确定性的持久 DSH Session，但这些 Session 很难在普通 Web 工作区中找到。渠道轮次不会发布可读标题或工作区归属，因此成功的外部对话可能已存在于持久化中，却没有明显的会话列表入口。

加入发布逻辑后暴露了一个持久化风险。运行时 `cwd` 是重启生效的配置，Session header 则记录不可变的创建 metadata。如果从当前配置解析工作区归属，配置变更后恢复的路由会被移到另一个工作区，随后 `attachSession()` 会因新路径与已存 header 不匹配而拒绝。因此，展示失败可能阻止本来有效的外部消息到达 agent。较旧的 Session header 也可能缺少 `cwd`，所以发布逻辑需要明确降级，而不是臆造路径。

## 决策

`@clawdsh/dsh-channel-agent` 会在新建或恢复的 agent 进入空闲后发布可选的 Host 展示 metadata。安装了 `sessionTitle` 且其报告没有已有标题时，driver 会设置 `外部消息 · <channel> · 私聊` 或 `外部消息 · <channel> · 群聊`，然后 flush Session。标题只包含经过归一化和长度限制的渠道名以及路由类型。它不包含消息文本、account 和 conversation 标识符，也不包含发送者标识符或名称；已有标题绝不会被覆盖。

工作区发布把 Session header 作为权威数据。配置的 `cwd` 会在创建 driver 前校验为绝对路径，并且只在新建路由 Session 时传入。恢复的 Session 保留其不可变 header，`workspaceRegistry.resolveByPath()` 接收的是 `handle.agent.session.header.cwd`，而不是当前重启配置。因此，把配置从工作区 A 改为 B 不会改变已有路由与 A 的关联，而新建路由会记录并发布 B。

旧 Session header 若没有 `cwd`，标题处理仍会执行，工作区解析和关联会跳过，driver 还会输出一条不带路由数据或路径的固定警告。标题查询、标题持久化、工作区解析和工作区关联的失败都会被独立包含，并且只输出固定诊断。这些可选展示失败都不会改变渠道轮次结果或抑制消息投递。

## 考虑过的替代方案

**始终按当前配置的 `cwd` 解析每个 Session。** 否决，因为重启配置不是持久的 Session 身份。该方案会在与不可变 header 不匹配的路径下发布恢复的 Session，并可能让普通配置漂移破坏渠道投递。

**当 `cwd` 变化时重写已存 header 或迁移已有路由。** 否决，因为 Session header metadata 和持久化位置不可变。移动对话需要显式 Session 迁移机制；展示代码不能默默重新定义其历史或存储身份。

**从消息、发送者、account 或 conversation 数据生成更具体的标题。** 否决，因为这些值可能包含私密内容和平台标识符。路由的渠道类型和私聊／群聊区分已足以支持发现，无需把个人数据复制到全局会话列表。

**把标题和工作区服务设为必需，或在发布失败时让轮次失败。** 否决，因为渠道执行在 headless 组合中仍然有效，展示也不属于平台投递。可选 Host 增强不能扩大已准入外部消息的失败范围。

## 影响

Host 提供相应服务时，渠道对话会出现在普通 Web Session 旁边，headless 部署则保留相同的执行行为。重启时的 `cwd` 变更具有可预测的作用范围：它们只影响此后创建的路由 Session。已有路由会保留在已记录的工作区中，直到显式生命周期操作创建不同的 Session。

隐私安全标题有意保持比平台对话名称更少的细节。缺少 `cwd` 的旧 Session 可以获得或保留标题，但无法通过该机制关联到工作区。操作者会获得有限的警告而不是失败的消息，并且任何依赖错误、本地路径、路由身份、发送者身份或消息内容都不会进入该诊断。

## 验证

聚焦的 Channel Agent 测试覆盖新 Session 标题和工作区关联、已有标题保留、脱敏的标题和工作区失败诊断、缺少 `cwd` 的旧 header，以及重启配置从工作区 A 漂移到 B 后新路由使用 B。Settings 路径覆盖会在创建 driver 前拒绝相对 `cwd`。完整 Channel Agent 测试目录、包 typecheck、聚焦 lint、双语配对、Agent Note 门禁和 diff 检查会校验已交付行为。
