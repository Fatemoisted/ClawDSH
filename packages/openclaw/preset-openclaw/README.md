# @clawdsh/dsh-preset-openclaw

**定位**：ClawDSH 的组装层——把 dsh 的既有能力与 `packages/openclaw/*` 插件组合成一个可启动的 "OpenClaw 形态" 个人助手。不改上游任何代码，只用 dsh 的 profile / bundle / patch 机制叠加。

**OpenClaw 对应**：整体产品形态（gateway + 渠道 + soul + memory + automation 的默认组合）。

**接缝**：不是插件，是 profile 定义（`cordis.yml` / patch 层）。参照上游 `apps/cli` 与 `packages/preset/` 的组装方式；启动命令目标：`pnpm dsh --profile openclaw --dump-config` 能看到完整 boot tree。

**规格**：docs/specs/roadmap.md（阶段 2 交付物） · **状态**：planning

## 组装草图（待 spike 验证）

```
openclaw profile
 ├─ dsh-base（上游 bundles：session/tools/skills/sandbox/schedule…）
 ├─ @clawdsh/dsh-soul          → 替换 system-prompt 装配
 ├─ @clawdsh/dsh-memory        → 替换 spillStore/session-persistence 后端
 ├─ @clawdsh/dsh-channel-core  → 新增 ctx.channels seam
 └─ @clawdsh/dsh-channel-telegram（+ 其他渠道按需）
```

每个用户可用 patch 层自由增删渠道/人格/记忆后端——这正是 OpenClaw 社区 PR 本应有的落地方式。
