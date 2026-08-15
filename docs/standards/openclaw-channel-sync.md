# OpenClaw channel-plane sync standard

English | [中文](openclaw-channel-sync.zh.md)

This standard governs every change to the OpenClaw host, channel catalog, bridge compatibility range, or support claim used by the ClawDSH channel plane. It implements [ADR-0008](../adr/0008-openclaw-channel-plane.md), composes Harness contracts under [ADR-0010](../adr/0010-harness-contract-first.md), and treats [ADR-0011](../adr/0011-deferred-channel-images-and-address-continuity.md) as legacy-only. It is separate from `upstream-sync.md`: DeepSeek Harness upstream and the embedded OpenClaw communication host have independent locks and review cycles.

## Authorities

| Item | Machine-readable authority | Human-facing projection |
|---|---|---|
| Production host | `tools/openclaw-channel-host/host.production.json` | ADR-0008 and the bridge spec |
| Production catalog | `tools/openclaw-channel-host/channels.production.json` | `docs/matrix/parity.md` |
| Production support | `tools/openclaw-channel-host/support.production.json` | `docs/matrix/parity.md` |
| Production external governance | `tools/openclaw-channel-host/governance.production.json` | host-lock README |
| Canary source | `tools/openclaw-channel-host/host.canary.json` | ADR-0008 and the bridge spec |
| Canary catalog | `tools/openclaw-channel-host/channels.canary.json` | audit notes only |
| Canary support | `tools/openclaw-channel-host/support.canary.json` | audit notes only |
| Canary external governance | `tools/openclaw-channel-host/governance.canary.json` | audit notes only |
| Runtime admission | `packages/openclaw/channel-openclaw/src/locks.ts` plus handshake validation | package README and bridge spec |
| Installer runtime projection | `packages/openclaw/channel-openclaw/runtime/production-lock.json`, equality-checked against the Provider lock | public bundle and CLI |

Do not copy a digest or channel roster into another executable source of truth. The installer JSON is a checked distribution projection of the Provider lock, not an independent authority. Documentation may state the approved tag, commit, aggregate counts, and meaningful deltas, but exact artifacts and per-channel metadata belong to these manifests.

## Track policy

Production uses a signed or dereferenced release tag and an exact runnable artifact. The current lock is OpenClaw `v2026.7.1-2`, commit `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, npm `openclaw@2026.7.1-2`, with verified npm integrity and reviewed Darwin arm64 and Linux x64 installed-runtime digests. Its catalog is 27 entries: 1 core + 2 bundled + 21 repository-official + 3 external, summarized as **24+3**.

Canary uses one explicitly approved commit, never a moving `main`. The current commit is `f1ced37ce5df8c7bc7f3b46c579e5ce181feaae0`. Its source archive and 31-entry catalog support review and compatibility development only. A source archive is not a built deployment artifact; managed canary execution remains unavailable until the build output and its provenance receive their own lock.

Production and canary may use different AgentHarness generations. A bridge build must declare which generation it implements, and the authenticated handshake must match the selected host lock exactly.

## Update procedure

1. **Resolve candidates without mutating locks.** Read the OpenClaw release tag object, dereferenced commit, published npm metadata, Node engine, license and notices, plugin SDK compatibility, and current channel documentation. Resolve canary to one commit and record the observation timestamp.
2. **Acquire immutable inputs.** Download the production npm tarball and canary source archive to a temporary directory. Record byte length where the manifest requires it. Never use a locally modified checkout as a lock input.
3. **Verify provenance and content.** Check production package name/version and registry integrity; calculate the archive SHA-512 and deterministic ordinary-file tree digest; reject symlinks or non-file entries where the verifier requires ordinary files. For canary, verify the source archive digest and record explicitly that no runnable tree exists.
4. **Regenerate channel catalogs and external governance.** Derive channel identity from OpenClaw docs, bundled/core registration, repository extensions, and explicitly documented external plugins. Record source path and package manifest for in-repository entries; record exact package name, version, and registry integrity for external entries. For every external entry, separately record its declared license and the evidence-backed license, platform-terms, and security review disposition. Reject duplicate ids, undocumented entries, count drift, unverifiable external packages, and external package identities that differ between the catalog and governance record.
5. **Classify provenance before support.** `core`, `bundled`, `repo-official`, and `external` describe ownership only. They are not support states. In particular, QQ Bot is `repo-official` in the current production lock, while WeChat, Yuanbao, and Zalo ClawBot are external. Preserve the stable **24+3** result and do not reclassify QQ Bot as external.
6. **Update bridge locks and compatibility.** Change the runtime lock, bridge peer range, notices, and generated bridge artifact together. Verify that OpenClaw still provides the required AgentHarness registration, sole-provider configuration, plugin load path, action surface, channel lifecycle, and delivery hooks. A compatibility shim must be isolated by host track and deleted when its track retires.
7. **Run static and keyless verification.** Run the host-manifest verifier, package tests, protocol tests, persistence/resume tests, typecheck for the three channel packages, license/notices checks, fail-closed config checks, exact runtime plugin inspection, and the assembled keyless Gateway-to-Agent smoke. Resume must prove that the runnable path persists only known Session event names until the upstream ignorable-append seam exists. A missing required lane blocks certification; it is not a reason to weaken the definition.
8. **Run credentialed certification per channel.** For each candidate channel, exercise account startup, admitted direct message, allowed group mention, denied sender/group, text and image inbound, Agent result, native outbound action, duplicate inbound, delivery retry/ambiguity, reset/close, reconnect, and sanitized health. Add platform-specific scenarios when the channel exposes richer actions. Record host commit, channel package integrity, OS, Node version, time, and redacted evidence.
9. **Promote states deliberately.** Update the support catalogs from cataloged to installable only after exact assembly succeeds; an external channel also requires approved license, platform-terms, and security reviews. Promote to certified only after all required release evidence passes, and to enabled only when a shipped profile intentionally activates it. Regenerate the four-state parity projection with `tools/openclaw-channel-host/generate-parity.ts --write`; never infer a later state from an earlier one.
10. **Review and land atomically.** The host lock, catalog, bridge compatibility, notices, tests, ADR/spec projections, parity matrix, and Agent Note update land in the same change. Production promotion requires review of the catalog delta and every newly external dependency.

## Runtime fail-closed requirements

- The configured OpenClaw model mode is `replace`; `clawdsh` is the only provider; `clawdsh/local` is the only allowed and primary model; fallbacks are empty; every model entry selects the ClawDSH AgentHarness.
- The verified `clawdsh-bridge` path appears exactly once in `plugins.load.paths`, is present in `plugins.allow`, and is explicitly enabled.
- The Gateway uses local mode and loopback binding. The supervisor passes per-startup IPC credentials only to the child process and does not persist them in the OpenClaw config.
- Runtime plugin inspection must show the bridge loaded and imported, with the expected `text-inference` provider and `agent-harness` capability ids and no error diagnostic. Static manifest presence alone is insufficient.
- The first IPC frame authenticates the peer and supplies the complete handshake. A tag, commit, artifact digest, Node engine, Gateway instance, startup nonce, AgentHarness generation, protocol version, or capability mismatch closes the connection.
- POSIX requires a private `0700` socket parent and a `0600` Unix socket. Windows is unsupported until named-pipe ACL enforcement has a native implementation; it fails closed rather than binding a weaker endpoint.
- Unknown protocol fields and unnegotiated methods fail. A transient detach does not cancel accepted work; an explicit shutdown aborts and drains work before closing durable storage. Reconnection reconciles only matching persisted terminal results and never switches models or silently reruns Agent tools or platform actions.

## Support-state evidence

| State | Minimum evidence | What it does not prove |
|---|---|---|
| Cataloged | Approved catalog entry, provenance class, exact source or package identity | Installability, credentials, runtime behavior |
| Installable | Compatible locked host, resolved exact artifact/source, integrity and manifest checks, plus recorded configuration, capability probe, and keyless Channel contract test | Platform access or live end-to-end behavior |
| Certified | Installable plus required contract, composition, security, snapshot, delivery, and current live transport evidence for the exact combination | That a deployment chose to run it |
| Enabled | Certified plus an explicit active shipped-profile entry and documented operator configuration | Support for unlisted accounts, modes, or actions |

Evidence expires when the host commit, channel artifact integrity, bridge protocol, AgentHarness generation, security configuration, attachment semantics, or relevant platform API changes. Documentation-only renames do not expire evidence unless they reveal a different artifact or behavior.

## Current certification blockers

The shipped profile contains the canonical sidecar composition and its three invariant companions while the Gateway remains explicitly disabled by default. A separate compatibility group registers only `ctx.legacyChannels` and is also default-disabled; legacy opt-in must make canonical Gateway startup and Settings preflight fail before side effects. Keyless evidence now covers policy-complete Telegram and Feishu configuration against the locked schema and the assembled Gateway-to-Agent path, but there is no complete per-Channel configuration/capability/delivery evidence or credentialed live evidence; Windows endpoint authorization is missing; stable AgentHarness V1 cannot supply safely staged inbound media; non-image dsh attachments and outbound media remain incomplete; the locked host exposes neither correlated final-answer delivery reports nor a public aggregate account-health seam; downstream namespaced Session events must remain disabled; every external governance review remains pending; and this change ran no fresh credentialed Telegram, Feishu, or Discord sidecar smoke. These are explicit blockers: all production sidecar entries remain `cataloged`, and no sidecar Channel is installable, certified, or enabled in the current support catalog.

The legacy `channel-telegram`, `channel-discord`, and `channel-feishu` packages remain until ADR-0008's replacement conditions pass. Their historical credentialed Telegram and Feishu traffic, keyless Discord coverage, and ADR-0011 media/address tests cannot be reused as sidecar certification because the host, Service namespace, execution path, admission owner, and delivery ledger differ.

## Rollback and incidents

Rollback selects the previous complete production lock and matching bridge build; never edit one digest in place or mix a previous host with a newer catalog. Preserve delivery ledgers and Gateway state for reconciliation. If a receipt is ambiguous, stop automated resend and reconcile through the platform or provider ledger. If provenance, package ownership, credentials, or IPC authorization is suspect, disable the affected channel or whole sidecar before restoring traffic.
