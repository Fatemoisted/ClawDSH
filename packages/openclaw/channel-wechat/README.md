# @clawdsh/dsh-channel-wechat（决策记录：不实现）

**定位**：微信系渠道的决策记录包。**本项目不实现微信系渠道核心包**。

**决策（2026-08-14，发起人确立）**：项目原则是"OpenClaw 上游有的才实现"。经核实（2026-08-14 调研 OpenClaw 最新 main），上游**没有任何微信系渠道**：
- `extensions/` 无 wecom / wechat / 公众号 / 个人微信 相关扩展；
- `extensions/tencent` 是腾讯云 LLM provider，不是渠道。

因此企业微信、公众号、个人微信**一律不做核心包**（包括此前讨论过的"企业微信优先"方案一并作废）。

**解除条件（未来重新评估的门槛）**：OpenClaw 上游出现微信系渠道扩展（如 `extensions/wecom`）时，按上游形态跟进；社区若用 wechaty 类方案自行接入，走 `ctx.channels` 契约注册（架构上天然支持，无需 core 改动）。

**接缝**：`ctx.channels`（若未来解除排除）。

**规格**：docs/matrix/parity.md「国内平台」节 · **状态**：不实现（原则性排除）
