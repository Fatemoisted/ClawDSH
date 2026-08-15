# @clawdsh/dsh-channel-core

English | [中文](README.zh.md)

**Purpose**: the legacy experimental channel seam. It provides `ctx.legacyChannels` for the pre-sidecar Telegram and Feishu adapters while they await credentialed live-cutover verification.

**OpenClaw correspondence**: an early local approximation of Gateway message ingestion. It does not implement or certify the current OpenClaw communication plane.

**Seam**: legacy-only `ctx.legacyChannels` (historical design: docs/adr/0002-channel-seam.md). The production Service Definition owns `ctx.channels`; this package deliberately exports no alias to that name.

**Specification**: docs/adr/0002-channel-seam.md · **Status**: legacy, disabled by the default profile, pending decommission after credentialed Telegram and Feishu sidecar cutover

## Usage

This configuration is retained only for explicit legacy deployments. It is not sidecar cutover evidence.

```yaml
- id: channel-core
  name: '@clawdsh/dsh-channel-core'
  config:
    # identity:                 # 呈现专属，绝不进 prompt
    #   name: ClawDSH
    #   emoji: 🐚
    responsePrefix: auto       # 'auto' → [name]；无名字时为空
    ackReaction: '👀'          # 缺省回退 identity.emoji → 👀；显式 '' 禁用 ack
    ackReactionScope: group-mentions  # all | direct | group-all | group-mentions
    requireMention: true       # group-mentions 下群聊须提及才 ack
```

## Design notes (see ADR-0002)

- A channel = a provider, uniformly implementing `ChannelAdapter`: `receive` (inbound), `send` (outbound), and `react` (optional ack emoji on inbound messages) as the capability kinds;
- Inbound messages first go through dsh's session mechanism (append-only log), then enter the agent loop — the "model-visible means logged" invariant is inherited naturally;
- Each channel plugin (telegram/whatsapp/…) implements only the adapter and does not touch routing logic;
- Identity presentation (`identity.{name,theme,emoji}`, `responsePrefix`, `ackReaction`, mention patterns) lives here, not in the prompt: `driveTurn` prefixes the extracted reply, fires the ack reaction, and the pure resolvers in `src/presentation.ts` carry OpenClaw's semantics (`'auto'` → `[name]`, ack fallback 👀).

## Model Experience

### Inbound message text

#### What the model sees

The router turns an inbound `channel/inbound` message into a user message (`followup(createUserMessage({ text }))`) in the per-thread agent session; the message `text` reaches the model verbatim through the session log, and the agent's reply is read back from the session's `assistant/message` text blocks.

#### Token effect

Inbound text contributes prompt tokens to the per-thread session and stays in that session's history until compaction.

#### KV Cache effect

Append-only; each inbound turn appends a user message to the reusable request prefix and does not invalidate prior cache entries.

## Known Limitations and Deferred Work

- **decommission gate**: remove this package only after credentialed Telegram and Feishu traffic has completed the OpenClaw sidecar live-cutover checks; that gate has not been claimed here.

- **real e2e**: the assembly test running a real agent turn inside the Loader needs a real key; currently covered by MockAdapter contract tests + `--dump-config` smoke.
- **concurrency**: per-thread tail-chain serialization as the fallback; cross-message interleaving and multi-sender merging deferred to stage 3.
- **channel features**: attachments/quotes/rich text/interactive cards all deferred (stage 3 channel extensions).
- **ack gate control-command bypass deferred**: OpenClaw's `shouldBypassMention` (control commands ack even without a mention) depends on a command concept the channel seam does not model yet; until then `group-mentions` requires a detected mention. `removeAckAfterReply` (delete the ack once the reply lands) is deferred too — it needs a list-then-delete reaction round-trip that does not warrant an asymmetric seam.
