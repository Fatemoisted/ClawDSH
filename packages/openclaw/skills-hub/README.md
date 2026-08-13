# @clawdsh/dsh-skills-hub

**定位**：ClawHub 兼容的技能加载器——让 OpenClaw 生态已有的 Skill（Markdown + 配置头）能直接作为 dsh 技能被加载，实现技能市场的平滑迁移。

**OpenClaw 对应**：Skills / ClawHub（技能目录、市场、版本锁定）。

**接缝**：`ctx.skills`（dsh 原生支持 provider 合并——多个技能来源自然共存）。

**规格**：阶段 3 交付物 · **状态**：planning

## 备注

- dsh 的 `ctx.skills` 本身就是"合并多个 provider 技能目录"的设计，ClawHub 只是新增一个 provider：架构红利直接兑现；
- ClawHub 的"发布即不可变快照、latest 可回滚"语义，用 dsh 的配置锁定即可实现，无需自建 registry。
