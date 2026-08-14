# Feature spec: WeChat-family channels (decision record: not implemented)

English | [中文](feature-channel-wechat.zh.md)

**Positioning**: decision record for WeChat-family channels. **This project does not implement any WeChat-family channel core package.**

**Decision (2026-08-14, established by the initiator)**: the project principle is "implement only what upstream OpenClaw has". Upon verification (2026-08-14, surveyed OpenClaw's latest main), upstream has **no WeChat-family channels at all**:
- `extensions/` has no wecom / wechat / Official Account / personal-WeChat related extension;
- `extensions/tencent` is a Tencent Cloud LLM provider, not a channel.

Therefore WeCom, Official Account, and personal WeChat are **all ruled out as core packages** (including the previously discussed "WeCom first" plan, which is voided together).

**Release condition (threshold for future re-evaluation)**: when a WeChat-family channel extension appears upstream in OpenClaw (e.g. `extensions/wecom`), follow the upstream shape; if the community integrates on its own with a wechaty-style approach, register through the `ctx.channels` contract (architecturally supported without any core change).

**Seam**: `ctx.channels` (if the exclusion is lifted in the future).

**Spec**: docs/matrix/parity.md "domestic platforms" section · **status**: not implemented (excluded on principle)
