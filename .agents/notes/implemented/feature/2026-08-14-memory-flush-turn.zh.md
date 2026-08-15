# Agent Note: 预压缩 memory flush 回合挂在 `agent/turn-stopping`

Status: implemented

[English](2026-08-14-memory-flush-turn.md) | 中文

## 问题

memory 规格的非目标里写着「no pre-compaction memory flush turn (Phase 3, hooks dsh compaction)」。OpenClaw 把 flush 作为**主回合之前的独立静默 agent 回合**运行，与会话共享，每压缩周期一次，触发条件是 `totalTokens >= contextWindow − reserveTokensFloor(20000) − softThresholdTokens(4000)`。而 dsh 的压缩在每个回合的 `agent/pre-step` 内同步执行——在它之前没有回合形态的钩子。要回答的问题：既然运行中的 agent 无法在自己的 pre-step 里嵌套完整 agent 回合，dsh 的哪个钩子能表达静默的预压缩回合？

## 决策

**flush 是 memory 包内的插件行（不是独立包），从 `agent/turn-stopping` 经 `agent.followup` 入队——一个带 plugin 源的普通已记录回合，在同一 agent 与会话上于回合之间运行。** 守卫每压缩周期触发一次，以会话日志中最新 `compaction/end` 的 seq 为键。

机制（全部对照 `packages/core/agent-loop/src/agent.ts` 源码验证）：

- `agent/turn-stopping` 在模型无欠响应且 inbox 无 next-step 工作时触发（`agent.ts:295-298`）；`agent.followup` 入队一个普通回合，同一 driver 继续执行（`agent.ts:299-324`）——无死锁、无第二 agent、同一份 transcript。
- 阈值读 `ctx.get('tokenMeter').measure(session).totalTokens` 与 `ctx.get('llm').resolveModelInfo(provider, model).context.contextWindow`（从 `session.requestHeader()?.config` 路由，compaction-basic 的模式），配置 `flush.{reserveTokensFloor=20000, softThresholdTokens=4000, prompt, enabled}` 经 z 校验。
- 每周期一次：`WeakMap<Agent, {throughSeq, pending}>`；`throughSeq` 是入队时最新 `compaction/end` 的 seq（持久的既有标记——无需新会话事件）；更新的压缩重新激活资格。压缩后的场景由阈值检查自然挡住（压缩把 `totalTokens` 缩到 flush 阈值以下）。
- NO_REPLY：默认 prompt 要求该应答，观察器在 info 级记录。Canonical 渠道投递绑定到已准入 `user/message` 所属的精确回合，因此后续 plugin 源 flush 回合不能替换该结果。
- 失败绝不阻塞主回合：flush 回合是独立回合，其错误由 driver 遏制。

**与 OpenClaw 的成文降质**（Known Limitations）：flush 在回合**之间**运行，因此 flush 完成前入队的入站会先跑；且 flush 回合自身的 pre-step 可能先触发压力压缩，flush 从压缩后的摘要写记忆。dsh 默认压缩阈值（0.8 × window）低于 flush 阈值（window − 24000），常见流程是压缩 → 从摘要 flush；想要 OpenClaw 顺序的部署把压缩 `thresholdRatio` 调到 flush 阈值之上。跳过清单（heartbeat/CLI/sandbox-ro）映射为挂载面 opt-in：不挂 memory 行的 profile 永不 flush。

## 考虑过的替代方案

**在 `agent/pre-step` 里、压缩监听器之前同步运行 flush。** 以源码证据否决：pre-step 期间 agent 处于 `running` 相位（`agent.ts:227`）；非 idle 时 `runMaintenance` 抛错（`agent.ts:142-143`）；在 waterfall 内 `await agent.whenIdle()` 死锁（该 waterfall 正被解析 `activityDone` 的那个 `kick()` 等待）。

**pre-step 里 `{kind:'reject'}` + 重新入队的编排。** 否决：被拒的 step 以 `blocked` 收尾，已 claim 的消息「既不丢弃也不重发」（`runtime-types.ts:188-191`）；running 相位内的重发不 latch wake，退出的 driver 清掉 `wakeRequested`，消息被停在 inbox 里没有 driver。

**回合内合并（把 flush 指令前置进主回合消息）。** 否决：指令与回复共享一个回合，无静默回合、无 NO_REPLY，且 flush 指令渗进主回复的上下文。

**用第二个 agent 挂同一会话跑 flush 回合。** 否决：会话是每 agent 独占；live 重名 id 守卫使同一会话无法挂第二个 handle，而新会话缺少 flush 要挖掘的对话上下文。

**独立 `memory-flush` 包。** 当前否决：flush 属于 memory 行的规格与 prompt 惯例（`RECALL_TEXT` 教的正是 flush prompt 引用的 `memory/YYYY-MM-DD.md` 工作流）；独立包为一个约 250 行的模块付出全套包仪式。若未来非 memory 存储后端需要 flush，再评估。

## 影响

- memory 规格的非目标条目移除；flush 进入 memory 行的验收标准。
- `feature-memory.md` 与 memory README 记录 flush 配置、模型可见 prompt 与上述两条降质；矩阵 memory 行保持单一 implemented 行。
- Canonical 渠道 Driver 从已准入消息所属的精确回合解析输出；plugin 源维护回合保持为独立日志回合，不能替换该输出。
- 若上游 dsh 将来提供预压缩回合钩子（或单回合压缩豁免），本 Note 的降质清单即升级检查表。
