# channel-wechat (historical non-package decision record)

English | [中文](README.zh.md)

**Positioning**: historical, non-package decision record for WeChat-family channels. **This project does not implement a native or direct-Harness WeChat adapter.** Current availability authority is the [parity matrix](../../../docs/matrix/parity.md).

**Historical decision (2026-08-14, established by the initiator)**: the project principle is "implement only what upstream OpenClaw has". At that snapshot, upstream had **no WeChat-family channels at all**:
- `extensions/` has no wecom / wechat / Official Account / personal-WeChat related extension;
- `extensions/tencent` is a Tencent Cloud LLM provider, not a channel.

Therefore WeCom, Official Account, and personal WeChat were **all ruled out as ClawDSH core packages** (including the previously discussed "WeCom first" plan, which was voided together). The current production catalog now identifies the external `@tencent-weixin/openclaw-weixin@2.4.6` extension; that discovery supersedes only the old availability statement, not the decision against a native adapter.

**Release condition**: a WeChat integration may ship only through the locked OpenClaw channel catalog after its exact extension identity passes lock, admission, assembly, and certification gates. The `channel-openclaw` sidecar then exposes it through canonical `ctx.channels`. Do not add a direct in-process Harness adapter or a second `ctx.channels` Provider.

**Seam**: none directly; `channel-openclaw` → canonical `ctx.channels` after admission.

**Spec**: [ADR-0008](../../../docs/adr/0008-openclaw-channel-plane.md) and the parity matrix's "production channel inventory" section · **status**: external extension cataloged, not certified or enabled; local directory remains a non-package record
