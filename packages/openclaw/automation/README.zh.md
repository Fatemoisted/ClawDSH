# @clawdsh/dsh-automation

[English](README.md) | 中文

**定位**：定时任务 / 自动化——用户配置"每天 9 点发摘要""文件变动时提醒"等规则，驱动 agent 主动发起会话。

**OpenClaw 对应**：Cron / Automation（定时触发、事件触发）。

**接缝**：`ctx.schedule` / `ctx.jobs`（dsh 原生已有调度与后台任务注册）。

**规格**：阶段 3 交付物 · **状态**：planning

## 备注

- 大概率是薄封装：dsh 已有 `schedule`、`jobs` 包，本插件只补"规则→agent 会话"的桥接与用户配置面；
- 触发产生的消息必须作为事件写入 session log，保证可追溯。
