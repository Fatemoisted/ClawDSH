# channel-wechat（历史非 package 决策记录）

[English](README.md) | 中文

**定位**：微信系渠道的历史非 package 决策记录。**本项目不实现原生或直连 Harness 的微信 adapter。**当前可用性权威见[对齐矩阵](../../../docs/matrix/parity.md)。

**历史决策（2026-08-14，发起人确立）**：项目原则是「OpenClaw 上游有的才实现」。在当时快照中，上游**没有任何微信系渠道**：
- `extensions/` 无 wecom / wechat / 公众号 / 个人微信 相关扩展；
- `extensions/tencent` 是腾讯云 LLM provider，不是渠道。

因此企业微信、公众号、个人微信**一律不做 ClawDSH 核心包**（包括此前讨论过的「企业微信优先」方案一并作废）。当前 production catalog 已识别外部扩展 `@tencent-weixin/openclaw-weixin@2.4.6`；这一发现只取代旧的可用性陈述，不改变拒绝原生 adapter 的决定。

**发布条件**：微信集成只能经锁定的 OpenClaw channel catalog 交付，且其精确 extension identity 必须通过 lock、admission、assembly 与 certification 门禁。随后由 `channel-openclaw` sidecar 经 canonical `ctx.channels` 暴露。不得新增进程内直连 Harness adapter，也不得新增第二个 `ctx.channels` Provider。

**接缝**：无直接 seam；通过 admission 后走 `channel-openclaw` → canonical `ctx.channels`。

**规格**：[ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md) 与对齐矩阵「production channel inventory」节 · **状态**：外部 extension 已 catalog，未认证且未启用；本地目录仍为非 package 记录
