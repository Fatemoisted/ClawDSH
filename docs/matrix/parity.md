# OpenClaw ↔ dsh feature alignment matrix

English | [中文](parity.zh.md)

> This matrix is ClawDSH's status authority. Each OpenClaw-derived domain or ClawDSH-native product domain has one classification and current status here. Exact OpenClaw channel artifacts and roster metadata remain in `tools/openclaw-channel-host/*.json`; this page projects their approved meaning. The [Harness context and reuse map](../specs/context-map.md) is the one-read guide to existing dsh seams and the upstream source that can be skipped.

## Classification

| Classification | Meaning |
|---|---|
| Reuse | Use an existing dsh capability directly |
| Plugin | Add a ClawDSH package on an existing seam |
| New seam | Add a complete Service Definition, Service Provider, and Consumer set with an ADR |
| Product assembly | Build a ClawDSH application or profile from public dsh APIs without modifying upstream source |
| Deferred | Keep work outside the current implementation and name its unblock condition |

Channel support uses only the monotonic states `cataloged → installable → certified → enabled`: cataloged records approved provenance; installable proves exact compatible assembly; certified adds current protocol, security, delivery, snapshot, and required live-transport evidence; enabled adds an explicit active shipped-profile choice. No earlier state implies a later one.

<!-- BEGIN GENERATED openclaw-channel-support (generate-parity.ts) — do not edit between markers -->
| Locked track | `cataloged` | `installable` | `certified` | `enabled` |
|---|---:|---:|---:|---:|
| production | 27 | 0 | 0 | 0 |
| canary | 31 | 0 | 0 | 0 |
<!-- END GENERATED openclaw-channel-support -->

## Baselines

Non-channel feature selection retains the Phase 1 reference, OpenClaw `v2026.1.5` at `197b8f7c3b`, with `v2026.1.15` used where memory or later feature completion required it. That early snapshot is not the channel compatibility baseline.

The production channel plane is locked to OpenClaw `v2026.7.1-2`, commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, and npm package `openclaw@2026.7.1-2`, with checked archive and extracted-tree identities. The isolated canary audit lock is source commit `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`; it has no locked built host and is not a managed deployment candidate. [ADR-0008](../adr/0008-openclaw-channel-plane.md) and the [OpenClaw channel sync standard](../standards/openclaw-channel-sync.md) own this split.

## Feature domains

| Product or OpenClaw domain | Reference | dsh seam | Classification | Landing package | Current status |
|---|---|---|---|---|---|
| Sessions / message history | early baseline sessions | `ctx.sessions` | Reuse | — | directly usable |
| Session tracing / replay / forking | dsh-native | Session projection and raw Trajectory | Reuse | — | directly usable |
| Tool execution | early baseline Agent tools | `ctx.tools`, `ctx.shell`, `ctx.fs`, `ctx.web` | Reuse | — | directly usable |
| Skills | OpenClaw skills / ClawHub conventions | `ctx.skills` | Plugin | `skills-hub` | implemented |
| Scheduling / automation | early baseline cron | `ctx.agents`, `ctx.sessions` | Plugin | `automation` | implemented; disabled by default |
| Persona | early baseline prompt/workspace identity | `ctx.systemPrompt` | Plugin | `soul` | implemented |
| Memory | v2026.1.15 memory | `ctx.fs`, `ctx.tools`, `ctx.embeddings` | Plugin + owned embeddings seam | `memory`, `embeddings`, `embeddings-ark` | implemented |
| Channel Service Definition | current Gateway integration | owned `ctx.channels` | New seam | `channel` | V1 implemented |
| Channel Agent Driver | dsh Session and Agent lifecycle | `ctx.channels`, Agents, Sessions, attachments | Plugin | `channel-agent` | foundation implemented; certification incomplete |
| OpenClaw communication Provider | locked Gateway and plugins | `ctx.channels`, subprocess, storage | Plugin | `channel-openclaw` | foundation implemented; disabled by default |
| Approval / security policy | later OpenClaw security reference | approvals and guards | Reuse/config | — | directly usable |
| Federation node | outside early baseline | `ctx.subagents` transport | Plugin | `clawd-federation` | ADR-0005 evaluation only; implementation deferred |
| Smart home | outside selected scope | no accepted seam | Deferred | — | requires a reviewed source and capability design |
| Local browser conversation | dsh Web client | `dsh-web-app` + `clawdsh` preset | Reuse/config | internal `preset-openclaw` source | reused inside the product shell and at native `/` |
| ClawDSH product shell and Settings | ClawDSH-native | public dsh Web assembly, Settings, and Credentials | Product assembly | internal `preset-openclaw` source | [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) shell and conflict-safe Settings implemented |
| ClawDSH semantic Activity | ClawDSH-native | standard Session history plus optional `ctx.clawdshActivity` sidecars | Plugin + product assembly | `activity` plus internal `preset-openclaw` UI | [semantic Activity](../specs/feature-activity.md) implemented; required in the `clawdsh` profile |
| ClawDSH public distribution | ClawDSH-native | dsh profile/bundle installation and npm publication | Product assembly | [exact 13-package allowlist](../../packages/openclaw/README.md#public-release-set) | `0.1.0-rc.1` bundle, CLI, installer, tarball audit, and OIDC/provenance workflow prepared; bootstrap required; unpublished |

The channel Agent path stores complete sanitized model provenance on the known `user/message.source.kind = 'channel'` field and keeps admission, idempotency, and delivery authority in durable channel ledgers. It does not persist declared `channel/*` Session events because downstream code cannot mark them ignorable and the static known-event reader would make resume fail closed.

The distribution CLI pins `@deepseek-ai/dsh@0.1.0-rc.6`, and the prepared release workflow targets only public npm `next` with OIDC trusted publishing and provenance. None of the thirteen package names exists, so the release is `bootstrap-required`, not `OIDC-ready`: initial creation requires separately authorized interactive 2FA publication, staged publishing is unavailable for new packages, and subsequent OIDC authority requires all thirteen trust records, the branch-restricted GitHub `npm` environment, and exact `refs/heads/clawdsh`. The repository remains private and no bootstrap, trust configuration, or publication has occurred.

## Production channel catalog

The stable public chat catalog contains 27 entries: **1 core + 2 bundled + 21 repository-official + 3 external = 24+3**. Exact names, package versions, integrities, source paths, and observation times live in `tools/openclaw-channel-host/channels.production.json`.

| Catalog group | Entries | Current support state | Evidence and limit |
|---|---:|---|---|
| Core + bundled + repository-official | 24 | **cataloged** | Exact stable host source and per-entry provenance are locked; per-channel assembly and certification are incomplete |
| External | 3 | **cataloged** | WeChat, Yuanbao, and Zalo ClawBot have exact package identities; external review and the same assembly and certification requirements still apply |

Catalog provenance is not a runtime support claim. A verified npm integrity does not make a channel installable until its compatible locked host and bridge composition assemble. The canary catalog contains 31 entries but remains cataloged audit input only.

The canonical runtime has one implementation path: `ctx.channels → channel-agent → channel-openclaw`. The production host records Telegram as bundled and records exact `@openclaw/feishu@2026.7.1` and `@openclaw/discord@2026.7.1` repository-official artifacts. The shipped profile nevertheless sets the Provider to `enabled: false` and `extensions: []`, while the installer creates `channels: {}`. `support.production.json` therefore keeps all three at `cataloged`, with no installability, certification, or enablement evidence. Telegram can be admitted from the locked bundled host; Feishu and Discord additionally require matching exact extension locks. Admission validation is a safety gate, not proof that a platform is installed, connected, certified, or enabled. ClawDSH ships no second direct-platform adapter implementation.

## China-focused platform projection

| Platform | Approved OpenClaw provenance | Current support state | Limit |
|---|---|---|---|
| Feishu / Lark | production repository-official extension | **cataloged** | exact artifact is recorded, but the shipped extension list is empty and no installability, certification, or enablement evidence exists |
| QQ Bot | production repository-official extension | **cataloged** | not one of the three production external plugins |
| WeChat | production external `@tencent-weixin/openclaw-weixin@2.4.6` | **cataloged** | external review and certification remain incomplete |
| Yuanbao | production external `openclaw-plugin-yuanbao@2.15.0` | **cataloged** | external review and certification remain incomplete |
| WeCom | canary external `@wecom/wecom-openclaw-plugin@2026.5.7` | **cataloged** in canary only | absent from the production lock |
| DingTalk | absent from both approved catalogs | — | no support claim |

The old `channel-wechat` exclusion record is not current availability authority. ClawDSH does not plan a native WeChat adapter; reuse goes through the locked OpenClaw communication plane.

## Maintenance rules

1. A feature-domain addition, removal, or reclassification updates this matrix and its owning spec.
2. A channel roster, artifact, or support-state change follows the OpenClaw channel sync standard and updates the machine catalogs first.
3. A deferred item names its unblock condition; historical completion language never substitutes for current evidence.
4. Re-review non-channel compatibility after each dsh upstream sync and channel compatibility after each separately approved OpenClaw lock change.
