# Agent Note: The test1 rebuild preserves one canonical channel plane

Status: implemented

English | [中文](2026-08-15-test1-channel-plane-rebuild.zh.md)

## Problem

The test1 branch contains useful legacy Telegram, Discord, and Feishu work, real-platform evidence, documentation, and fork CI repairs. Applying that branch as one historical snapshot would also restore its in-process channel seam as the production architecture and overwrite the locked OpenClaw channel-plane work already present at base commit `20f0910dbe`. The two implementations use similar vocabulary but have different ownership, security, durability, and certification boundaries, so silently combining them under one Cordis Service would make both contracts ambiguous.

The branch also needs to remain maintainable as a DeepSeek Harness extension. Reimplementing Session, Agent, model, tool, preset, attachment, timer, credential, and Cordis lifecycle facilities inside channel packages would create a second runtime whose behavior drifts from the Harness.

## Decision

The branch keeps the locked OpenClaw design from `20f0910dbe` as the only canonical production channel plane. Its Service Definition remains `ctx.channels`; `@clawdsh/dsh-channel-agent` drives the existing Harness Agent and Session, and `@clawdsh/dsh-channel-openclaw` owns the authenticated sidecar Provider. The complete sidecar group is present in the `clawdsh` profile but is default-disabled because no individual OpenClaw Channel is currently certified or enabled.

The restored in-process adapters are compatibility code only. Their registry is renamed to `ctx.legacyChannels`, their package descriptions and docs say legacy, and Telegram, Discord, and Feishu inject only that Service. The profile puts them in the separate `clawdsh-legacy-channel-plane` group. It requires the master `CLAWDSH_LEGACY_CHANNELS_ENABLED=1` switch plus one per-adapter switch and remains off by default. When the master opt-in is present, canonical Gateway startup and Settings preflight fail loudly before side effects. This mutual exclusion prevents the same platform account from being consumed by two runtimes. Legacy packages remain excluded from the ClawDSH publish set.

This integration follows the contract-first rule in [ADR-0010](../../../../docs/adr/0010-harness-contract-first.md): channel code composes the Harness's Agent, Session, model, tools, presets, attachments, credentials, timers, effects, and Cordis Services before introducing local code. The maintained lookup map is [the Harness reuse matrix](../../../../docs/matrix/harness-reuse.md). Local channel code is limited to platform translation, route and presentation policy, compatibility bookkeeping, and the canonical sidecar protocol surfaces that the Harness does not already provide.

## Evidence and certification boundary

Historical credentialed runs remain useful regression evidence for the exact legacy path they exercised: Feishu text round-trip passed on 2026-08-14 and Telegram direct, group, topic, reply, caption, image, reaction, chunking, restart, and offline/reconnect cases passed on 2026-08-15. Discord has keyless contract coverage but no completed credentialed server E2E. The [Telegram cookbook](../../../../docs/cookbook/telegram-e2e.md) records the repeatable procedure and the exact scope of those conclusions.

None of that evidence promotes an OpenClaw catalog row. It does not exercise the locked Gateway artifact, authenticated IPC handshake, `ctx.channels`, delivery ledger, or current sidecar release composition. The canonical sidecar therefore stays cataloged, default-disabled, and uncertified until its own assembled keyless transcript and required live-platform tests pass. Legacy credentials remain environment references and are never stored in the repository.

## CI and verification

Fork-safe CI keeps checks meaningful without assuming that every mirror owns the upstream repository's GitHub App, project credentials, or API secret. Issue lifecycle and policy automation run only in `deepseek-ai/deepseek-harness`. Real DeepSeek API E2E runs by default in that canonical repository; a mirror must set `DSH_REAL_API_E2E_ENABLED=true`, trusted same-repository pull requests are the only pull requests admitted, and an enabled run fails during preflight when `DEEPSEEK_API_KEY_EXTERNAL` is absent. Wine and native host builds both use `tsconfig.host.json`, and `scripts/ci-workflow.spec.ts` pins these workflow contracts.

The branch is verified by the legacy adapter unit and presentation suites, the profile smoke tests, the canonical channel-plane suites, workspace typecheck/lint/JSDoc gates, CI-workflow tests, translation pairing, Markdown link/wrap checks, documentation budgets, and Agent Note format checks. Credentialed live E2E remains an explicit manual or secret-backed release step and is reported per execution path rather than inferred from unit coverage.

The root `AGENTS.md` documentation ceiling is narrowly 1,950 words. The retained upstream rules already occupy 1,904 words, and the mandatory 30-word fork ownership/Harness-map routing brings the current file to 1,934; this bounded increase preserves upstream text instead of rewriting it to satisfy the former 1,900-word ceiling, while the manifest continues to act as a ratchet against unrelated growth.

## Supersession

This note does not supersede the [locked OpenClaw channel-plane decision](2026-08-15-openclaw-channel-plane-bridge.md). That note remains authoritative for the canonical architecture, protocol, security, durability, and certification ladder. The [legacy identity-presentation](../feature/2026-08-14-channel-identity-presentation.md) and [ack-reaction](../feature/2026-08-14-ack-reaction-scope.md) notes continue to own their compatibility behavior, while the [ClawDSH identity and clean-install defaults](../feature/2026-08-15-clawdsh-identity-and-safe-defaults.md) note continues to own installed identity and credential-free startup. This note owns the rebuild's compatibility isolation, Harness-first integration boundary, historical evidence classification, and fork-CI behavior; no other active Agent Note covers that combined decision.

## Alternatives considered

- **Restore the old branch wholesale** — rejected because it would replace the reviewed sidecar boundary with an in-process platform seam and make historical live tests look like certification for code they never exercised.
- **Delete all legacy adapters and evidence** — rejected because the implementations and real Telegram/Feishu findings are useful compatibility and migration assets while the sidecar remains uncertified.
- **Expose both implementations as `ctx.channels`** — rejected because Cordis injection would become ambiguous and the profile could start two consumers for one platform account.
- **Enable either channel plane by default** — rejected because the sidecar lacks per-Channel certification and the legacy path is retained only for explicit compatibility use.
- **Recreate Harness facilities inside channel packages** — rejected because it duplicates stable contracts, expands security and persistence ownership, and makes future upstream synchronization harder.

## Consequences

The branch preserves the fuller legacy functionality without weakening the locked production architecture. Developers have one canonical Service, one visibly separate compatibility Service, an explicit opt-in and mutual-exclusion rule, and a map showing which Harness contracts to reuse. Historical live evidence remains available without overstating what it certifies, while each sidecar Channel must still earn its own support promotion.

The cost is temporary dual maintenance: compatibility adapters and their tests remain until the locked sidecar reaches equivalent certification, profile operators must choose an execution path explicitly, and documentation and release reports must name that path whenever they report channel status.
