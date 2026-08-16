# @clawdsh/dsh-channel-openclaw

English | [中文](README.zh.md)

`@clawdsh/dsh-channel-openclaw` is the OpenClaw communication-plane Service Provider for the [channel Service Definition](../channel/README.md). It verifies and supervises one locked OpenClaw Gateway, authenticates its local bridge, forwards admitted turns to the Agent-plane driver, and returns native channel actions to OpenClaw. OpenClaw retains platform credentials, login state, admission policy, protocol clients, media acquisition, and final platform delivery; the [Agent consumer](../channel-agent/README.md) retains model selection, prompts, tools, memory, Sessions, and model-visible history. The [Harness context and reuse map](../../../docs/specs/context-map.md) records the dsh services reused by this single canonical path.

## Configuration

The plugin is always mounted and registers its existing schema under `clawdsh-channel-openclaw` when the DSH Settings service is present. Schema defaults, the profile base, and the user layer are resolved once at startup with `applies: restart`. The user layer may change `enabled` and bounded ports, frame limits, concurrency, and timeout values. A change to `track`, Gateway identity, artifact/runtime/host/Node/config/state/staging/socket paths, extension locks, or the media limit is rejected before persistence or startup, including a hand-edited Settings document. `enabled` defaults to `false`; in that state the plugin does not inspect artifacts, open storage, bind a socket, spawn a process, or register a Provider. The ClawDSH control plane runs the complete locked runtime, Node, OpenClaw config, and plugin-inspection preflight before it persists an enablement change.

Every enabled deployment path, identity, port, timeout, and resource limit is explicit. The managed installer must provision `stateDir` and `stagingRoot` as existing private `0700` directories; after read-only preflight succeeds, startup creates the private workspace. `configPath`, `endpoint`, and `stagingRoot` must remain beneath `stateDir` without a symlinked parent.

```yaml
- id: channel-openclaw
  name: '@clawdsh/dsh-channel-openclaw'
  config:
    enabled: false
    track: production
    gatewayInstanceId: personal-gateway
    artifactPath: /srv/clawdsh/openclaw/openclaw-2026.7.1-2.tgz
    runtimeRoot: /srv/clawdsh/openclaw/runtime
    hostRoot: /srv/clawdsh/openclaw/runtime/node_modules/openclaw
    extensions: []
    nodePath: /srv/clawdsh/node/bin/node
    configPath: /srv/clawdsh/openclaw/state/openclaw.json
    stateDir: /srv/clawdsh/openclaw/state
    stagingRoot: /srv/clawdsh/openclaw/state/staging
    maxMediaBytes: 5242880
    endpoint: /srv/clawdsh/openclaw/state/clawdsh.sock
    gatewayPort: 18789
    maxFrameBytes: 1048576
    maxInFlight: 16
    requestTimeoutMs: 30000
    handshakeTimeoutMs: 10000
    startupTimeoutMs: 30000
    shutdownGraceMs: 10000
    diagnosticBytes: 262144
- id: channel-openclaw-invariant
  name: '@clawdsh/dsh-channel-openclaw/invariant'
```

| Key | Contract |
|---|---|
| `enabled` | User-controlled Gateway enablement. `false` keeps only Settings and sanitized lifecycle status mounted; changing it takes effect after restart. |
| `track` | Selects the checked-in `production` or isolated `canary` host identity. It never resolves a floating tag. |
| `gatewayInstanceId` | Stable non-blank identity included in routes, handshakes, storage, and cross-Gateway isolation checks. |
| `artifactPath` | Absolute downloaded archive whose SHA-512 must equal the selected host lock. |
| `runtimeRoot` / `hostRoot` | Absolute checked npm project and its exact `node_modules/openclaw` child. Package inputs, visible lock, hidden installed lock, actual package set, package metadata, extracted host tree, and the current platform's complete installed-project digest are verified before Node runs. |
| `extensions` | Installer-managed exact opt-in plugin locks, shown read-only by the product UI. Each entry names `pluginId`, non-empty unique `channelIds`, exact npm `packageName` and semantic `version`, a 64-byte `sha512` SRI, and the isolated npm project's `projectTree.fileCount` and lowercase `projectTree.sha512`. Empty disables all external extensions. |
| `nodePath` | Dedicated absolute executable or bare executable name. Its reported version must satisfy the locked host engine range. |
| `configPath` / `stateDir` / `stagingRoot` | Strict JSON OpenClaw config, private isolated state, and shared inbound-media staging root. The supervisor reads and parses the complete config to enforce admission policy, but it does not select credential fields for return, logs, or DSH persistence; OpenClaw's config and state remain their owner. |
| `maxMediaBytes` | Positive safe-integer byte limit injected into the bridge for every staged inbound media item. |
| `endpoint` | Absolute Unix socket path inside `stateDir`; the bound socket is changed to `0600`. TCP is not accepted. |
| `gatewayPort` | Integer loopback Gateway port from 1 through 65535. The OpenClaw config must also select local mode and loopback binding. |
| `maxFrameBytes` / `maxInFlight` | Positive safe-integer bounds for UTF-8 NDJSON frames, concurrent requests in each direction, and pending outbound progress writes. |
| `requestTimeoutMs` | Positive safe-integer deadline for each DSH-to-Gateway RPC wait. Expiry releases local capacity but does not cancel remote work or make a mutation safe to retry. |
| `handshakeTimeoutMs` / `startupTimeoutMs` | Positive safe-integer bounds for each socket's first authenticated frame and for host preflights plus the first accepted bridge identity. |
| `shutdownGraceMs` / `diagnosticBytes` | Positive safe-integer process-tree shutdown bound and per-stream retained diagnostic byte bound. Lossy preflight output fails startup. |

The OpenClaw JSON must replace the model registry with only `clawdsh/local`, advertise only the stable V1 `text` input, select the `clawdsh` AgentHarness for every default and named Agent route, use an empty fallback list, place the Agent workspace at `stateDir/workspace`, and set `session.dmScope` to `per-account-channel-peer`. `plugins.load.paths` contains only the verified bridge root; `plugins.allow` and enabled `plugins.entries` contain exactly `clawdsh-bridge` plus locked extension ids; `plugins.installs` is empty. Bash, config, MCP, plugin, debug, restart, and native-skill commands are explicitly disabled; admitted text commands require access groups, wildcard senders are forbidden, global and every named Agent must set `tools.elevated.enabled: false`, and Agent defaults must set `elevatedDefault: off`. A `channels` object is required even when it is empty, and every entry and account must set `enabled` explicitly. The locked admission validators can accept bundled Telegram, plus Feishu or Discord only when the configured channel id is owned by a matching exact extension lock. All three require `configWrites: false`, safe DM and group policies, and explicit mention admission through Telegram groups, Feishu configuration, or Discord guilds as applicable. Other cataloged Channels must remain disabled until their version-specific admission fields receive a validator. Unsafe nested policy values and public wildcard senders are rejected for every Channel. A mismatch fails before the Gateway starts.

This validator coverage is not a support-state promotion. The production catalog records Telegram as bundled and exact repository-official artifacts for Feishu and Discord, but the shipped profile has `enabled: false` and `extensions: []`, and the installer starts from `channels: {}`. The machine support catalog classifies every production channel, including these three, as `cataloged`; none is installable, certified, or enabled. ClawDSH ships no direct Telegram, Feishu, or Discord adapter beside this OpenClaw communication plane.

## Locked Host and Extensions

[`PRODUCTION_OPENCLAW_LOCK`](src/locks.ts) identifies OpenClaw `v2026.7.1-2`, its peeled commit, release archive, package version, Node engine, checked runtime dependency lock, extracted host tree, and complete installed runtime digests keyed by Node platform and architecture. The packaged [`runtime/package-lock.json`](runtime/package-lock.json) is the deployment assembly input: installed dependencies must match its required current-platform set exactly, and every ordinary file in the project must match the approved platform digest. Internal file symlinks are locked by their logical path, canonical in-project target, and target bytes; escaping links, non-file targets, and untracked packages fail verification. A platform without one exact aggregate lock cannot start production.

External Channel plugins are never installed or updated at runtime. An operator provisions one private npm project under `stateDir/npm/projects/<project>` for each configured lock. That project must be private, request exactly one locked package at its exact version, and have matching checked, hidden, and actual dependency sets. Every installed package name and version is verified, and `projectTree` locks the project manifest, both npm locks, the primary plugin, and every transitive dependency byte. Internal file symlinks are locked with their targets. The only permitted external package symlink is an optional nested `openclaw` peer that resolves to the separately verified host; its presence is included in `projectTree`, while its target bytes remain owned by the host runtime lock. Provisioning must also persist the same source, exact spec, canonical install path, resolved package identity, version, and integrity in OpenClaw's installed-plugin index; `plugins.installs` remains absent or empty in `openclaw.json`. OpenClaw's runtime inspection must then report the exact package, version, integrity, canonical path, enabled state, trusted official installation, and locked Channel ids with no error diagnostic. Third-party ownership and license obligations remain with the separately installed package; see [Third-party notices](THIRD_PARTY_NOTICES.md).

## Local IPC and Lifecycle

The Provider accepts one bridge on a private Unix socket. Each startup creates a random bearer token and nonce, injects them only into the supervised process environment, and requires them in the first frame together with the exact Gateway instance, OpenClaw lock, Node engine, and AgentHarness generation. Token comparison is constant-time. A second connection, malformed identity, timeout, or unsupported host lineage is rejected without model fallback.

After authentication, peers exchange strict JSON-RPC 2.0 objects over bounded UTF-8 NDJSON. Extra envelope fields, responses containing both `result` and `error`, malformed errors, and unknown notifications fail closed. The router implements `turn.run`, `turn.cancel`, `session.reset`, `session.close`, `channel.action`, and `health.get`; negotiated `turn.progress` is presentation-only, and pending progress writes are bounded by `maxInFlight` so excess updates can be dropped under backpressure. Every DSH-to-Gateway request has a local deadline. A request timeout releases only the local wait and does not make remote work safe to retry. A transient Provider-side transport detach rejects socket-owned waits and new calls but lets admitted handlers settle into the durable Agent ledger; their progress remains bound to the detached peer and becomes a no-op rather than leaking into a reconnect. Provider-owned shutdown upgrades every active or detached peer to abort its admitted handler signals, then drains those handlers before storage closes. Reconnection restores transport, while durable Agent and Provider ledgers decide whether work or delivery can be replayed.

Startup uses the restart-scoped Settings snapshot and verifies the runtime, artifact, extensions, Node engine, fail-closed config, OpenClaw config validator, and runtime plugin inspections before binding the Provider and spawning `gateway run`. The same full preflight is exposed to the local control plane without creating directories, opening storage, binding IPC, or starting the Gateway; only the verified, locked inspection subprocesses run. Every Node preflight and the Gateway receive explicit tombstones for inherited `NODE_*`, `LD_*`, `DYLD_*`, OpenSSL module/config, TLS trust-path, and TLS key-log variables, preventing ambient loaders or Node options from altering the verified runtime. Readiness requires an authenticated bridge handshake followed by bridge-reported ready status after durable route recovery while the process remains alive. Disposal stops new peers, terminates and waits for the Gateway process tree, synchronously owns and drains active and detached RPC peers before closing the socket and storage domain, and removes only the exact socket entry. The Provider drain is bounded by `shutdownGraceMs`; timeout or independent cleanup failure is reported instead of hidden.

The [`bridge`](bridge/README.md) directory owns the OpenClaw-loaded V1/V2 adapters and their narrower host-facing capability details.

## Action and Delivery Durability

The `clawdsh_channel_openclaw` storage domain records side-effecting `send`, `edit`, `delete`, `react`, `poll`, and `typing` actions before dispatch. Reusing an action id with different input fails. A completed result replays without another platform request; a running record found after restart becomes `needs-recovery`. A retry of the same action then uses the read-only `channel.reconcile` method: the bridge may replay its durable completed result, but a missing or non-terminal bridge record fails without platform dispatch. Directory and resolution queries do not create side-effect recovery state.

Delivery receipts are durable before projection to the Agent consumer. A delivery id cannot change subjects, attempts cannot decrease, retrying cannot regress to accepted or repeat the same attempt with changed data, a learned platform message id cannot change or disappear, and confirmed, ambiguous, or dead-letter states are terminal. These rules expose uncertain delivery for reconciliation; they do not claim exactly-once behavior from a platform that accepted a request but lost its acknowledgement.

## Extension Points

`OpenClawChannelProvider` implements `ChannelProviderV1` and is registered as the single `ctx.channels` Provider. `OpenClawSupervisor` owns verified process lifecycle. The exported lock and verification functions support acquisition tooling and deployment preflights; they do not authorize a caller to weaken the checked identities. Platform-specific code belongs in OpenClaw Channel plugins, not this package.

## Assembled Keyless Smoke

The Linux x64 communication-plane workflows pin Node `24.19.0` and npm `10.9.7`, install the nested locked runtime, acquire the exact production npm artifact, and run the assembled smoke immediately afterward. The same command is supported by the reviewed Darwin arm64 assembly when it runs under a Node version accepted by the host lock:

```sh
npx --yes npm@10.9.7 ci --ignore-scripts --prefix packages/openclaw/channel-openclaw/runtime
artifact_dir=$(mktemp -d)
npx --yes npm@10.9.7 pack --silent --ignore-scripts --pack-destination "$artifact_dir" openclaw@2026.7.1-2 >/dev/null
pnpm exec tsx packages/openclaw/channel-openclaw/tests/assembled-smoke.ts "$artifact_dir/openclaw-2026.7.1-2.tgz"
```

This test asks the real stable OpenClaw schema to validate credential-free Telegram and Feishu policy fixtures, then separately starts the verified production Gateway, traverses the stable V1 bridge and the real DSH `channel` and `channel-agent` packages, and obtains a terminal answer from a deterministic mock LLM. It does not install either platform extension or traverse Telegram, Feishu, or Discord transport. It then disconnects the Provider and proves a second Gateway request returns the bridge failure with `fallbackUsed: false` and without another DSH model call.

The request deliberately omits `--deliver`. The assertion stops at the terminal `ChannelTurnResultV1` and a completed Agent ledger record because the locked host has no public hook that correlates final platform delivery. The smoke therefore does not fabricate a platform receipt or confer Channel certification.

## Model Experience

### OpenClaw communication-plane Provider

#### What the model sees

Nothing directly. The [Agent consumer](../channel-agent/README.md) owns admitted user messages, attachment references, the route-bound `message` tool, and every model-visible failure or result; this package contributes transport, health, and durable delivery state only.

#### Token effect

Zero direct tokens. IPC frames, host inspection, action ledgers, delivery receipts, and health diagnostics do not add a system prompt, user message, tool schema, or model request.

#### KV Cache effect

No direct invalidation. Gateway reconnection, receipt updates, host health, and Provider lifecycle do not alter an already reusable model request prefix; Session generation and Agent composition remain consumer-owned.

## Known Limitations and Deferred Work

- **Production admits only reviewed Darwin arm64 and Linux x64 runtime bytes** — each installed-project aggregate was generated with the checked dependency lock and npm `10.9.7`. Windows and other CPU pairs fail closed until acquisition produces and reviews their own platform lock. The Canary lock records an audited source snapshot and AgentHarness V2 generation but has no approved extracted-tree or runtime-dependency lock, so managed Canary startup also fails closed.
- **POSIX only** — Windows named-pipe support remains disabled until a native implementation can enforce the peer ACL; the package never substitutes localhost TCP.
- **The locked bridge advertises only `send` and `poll`** — other V1 action variants remain protocol-valid but fail capability checks until the OpenClaw bridge has equivalent public host APIs.
- **Media support is asymmetric** — outbound Provider actions reject media until DSH owns a verified staging writer; stable V1 rejects inbound media because its AgentHarness lacks a safe materialized-file fact, while V2 accepts only verified local staging files.
- **Final delivery reporting is not negotiated by the locked bridges** — both host generations lack a public, correlatable final-delivery hook, so the Agent-side ledger cannot receive `delivery.report` from these adapters. Final-delivery claims, and any Channel certification that requires them, remain blocked.
- **Per-account health is unavailable to the local bridge** — locked OpenClaw permits `channels.status` Gateway requests only from bundled or trusted-official plugins, while `clawdsh-bridge` is loaded from a verified local path. Bridge health therefore reports only authenticated transport readiness, keeps `accounts` empty, and emits the fixed `OPENCLAW_ACCOUNT_STATUS_UNAVAILABLE` diagnostic; it does not claim that configured platform accounts are connected.
- **Crash ambiguity requires reconciliation** — a side effect whose acknowledgement was lost is retained as recovery-required or ambiguous and is never blindly resent.
- **Chat only** — voice calls, live audio, and meeting lifecycles require separate protocols.
- **Certification is external evidence** — keyless tests verify this Provider and bridge protocol, not shipped per-Channel assembly, live account credentials, platform terms, hardware dependencies, or per-Channel certification. The checked support catalog is authoritative and currently leaves every Channel at `cataloged`.
