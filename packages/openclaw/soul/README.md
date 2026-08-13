# @clawdsh/dsh-soul

**定位**：人格系统（Soul）——为每个 agent 提供可替换的人格定义（系统提示词装配 provider）。用户可像 OpenClaw 的 Soul 一样配置/分享人格，人格之间互不干扰。

**OpenClaw 对应**：Soul 系统（人格、口吻、行为准则、自述文件）。

**接缝**：dsh 的 system-prompt 装配（`packages/core/system-prompt`）。**不新增 seam**——这是阶段 0 Spike 的首选验证对象：用最小成本验证"用 dsh 接缝替换 OpenClaw 能力"这一核心假设。

**规格**：docs/specs/feature-soul.md · **状态**：planning（Spike 候选 #1）

## Spike 目标

1. 挂载后能替换 agent 的系统提示词；
2. 人格切换可热插拔（unmount 即回卷）；
3. 人格内容走配置/patch，不改上游源码。
