# ClawDSH extensions

English | [中文](clawdsh.zh.md)

The **ClawDSH extensions** subsystem is the product layer under [`packages/openclaw`](../../packages/openclaw/README.md). It adds the canonical external-channel seam (`ctx.channels`), the OpenClaw control and activity services, Soul settings, and embeddings without duplicating the DeepSeek Harness agent loop. Telegram, Discord, and Feishu are catalog entries beneath the single `channel → channel-agent → channel-openclaw` path described in the [OpenClaw package map](../../packages/openclaw/README.md); catalog presence does not mean that a route is certified or enabled.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxchannels--channels"></a>

### `ctx.channels` — `Channels`

Bidirectional channel runtime. A single provider owns platform communication, while a single driver owns Agent execution. Registrations unwind with their contributing Cordis fibers.

```ts cordis-catalog
/**
 * Register the communication-plane provider.
 * @param provider - Platform action and health implementation with a non-blank id.
 * @returns A disposer that releases the single provider slot.
 * @throws {ChannelError} `CHANNEL_INVALID_PROVIDER` for a blank id or
 * `CHANNEL_DUPLICATE_PROVIDER` while another provider is active.
 */
registerProvider(provider: ChannelProviderV1): () => void

/**
 * Register the Agent-plane driver.
 * @param driver - Turn and session-control implementation.
 * @returns A disposer that releases the single driver slot.
 * @throws {ChannelError} `CHANNEL_DUPLICATE_DRIVER` while another driver is active.
 */
registerDriver(driver: ChannelDriverV1): () => void

/**
 * Dispatch one admitted inbound turn to the active Agent-plane driver.
 * @param turn - Validated turn envelope.
 * @param execution - Explicit run cancellation and progress publication.
 * @returns The driver's terminal replayable result.
 * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
 */
runTurn(turn: ChannelTurnEnvelopeV1, execution: ChannelTurnExecutionV1): Promise<ChannelTurnResultV1>

/**
 * Cancel one exact live channel run.
 * @param request - Turn/run identity and caller intent.
 * @param signal - Optional cancellation of the control request.
 * @returns Completion after the driver accepts cancellation.
 * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
 */
cancel(request: ChannelTurnCancelV1, signal?: AbortSignal): Promise<void>

/**
 * Retire one channel session generation and accept its successor.
 * @param request - Current route and strictly newer generation.
 * @param signal - Optional cancellation of the control request.
 * @returns The accepted successor route and retired session identity, when present.
 * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
 */
reset(request: ChannelSessionResetV1, signal?: AbortSignal): Promise<ChannelSessionResetResultV1>

/**
 * Drain and release one channel session generation.
 * @param request - Route and close cause.
 * @param signal - Optional cancellation of the control request.
 * @returns Completion after the driver closes the route.
 * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
 */
close(request: ChannelSessionCloseV1, signal?: AbortSignal): Promise<void>

/**
 * Project a provider-committed final-turn delivery receipt into the Agent plane.
 * @param report - Negotiated delivery-report extension payload.
 * @param signal - Optional cancellation of the projection request.
 * @returns Completion after the active driver records the receipt.
 * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active or
 * `CHANNEL_DELIVERY_REPORT_UNSUPPORTED` when it did not register the optional extension.
 */
reportDelivery(report: ChannelDeliveryReportV1, signal?: AbortSignal): Promise<void>

/**
 * Execute one native platform action through the active provider.
 * @param action - Capability-checked outbound operation.
 * @param signal - Optional cancellation forwarded to the provider.
 * @returns The provider's durable delivery state.
 * @throws {ChannelError} `CHANNEL_NO_PROVIDER` when no provider is active.
 */
action(action: ChannelActionV1, signal?: AbortSignal): Promise<ChannelActionResultV1>

/**
 * Read current provider, Gateway, and account health.
 * @param signal - Optional cancellation forwarded to an active probe.
 * @returns A sanitized provider health snapshot.
 * @throws {ChannelError} `CHANNEL_NO_PROVIDER` when no provider is active.
 */
health(signal?: AbortSignal): Promise<ChannelHealthV1>
```

Types: [ChannelActionResultV1](../../packages/openclaw/channel/README.md) · [ChannelActionV1](../../packages/openclaw/channel/README.md) · [ChannelDeliveryReportV1](../../packages/openclaw/channel/README.md) · [ChannelDriverV1](../../packages/openclaw/channel/README.md) · [ChannelHealthV1](../../packages/openclaw/channel/README.md) · [ChannelProviderV1](../../packages/openclaw/channel/README.md) · [ChannelSessionCloseV1](../../packages/openclaw/channel/README.md) · [ChannelSessionResetResultV1](../../packages/openclaw/channel/README.md) · [ChannelSessionResetV1](../../packages/openclaw/channel/README.md) · [ChannelTurnCancelV1](../../packages/openclaw/channel/README.md) · [ChannelTurnEnvelopeV1](../../packages/openclaw/channel/README.md) · [ChannelTurnExecutionV1](../../packages/openclaw/channel/README.md) · [ChannelTurnResultV1](../../packages/openclaw/channel/README.md)

Source: [`packages/openclaw/channel/src/index.ts:65`](../../packages/openclaw/channel/src/index.ts)

<a id="ctxclawdshactivity--clawdshactivity"></a>

### `ctx.clawdshActivity` — `ClawdshActivity`

Typed semantic Activity sink and safe sidecar reader.

```ts cordis-catalog
/**
 * Record a ClawDSH prompt section proven to have entered a request header.
 * @param input - Section identity, append/replace mode, byte-independent character count, digest, and Session sequence.
 * @returns sanitized best-effort append outcome.
 */
promptContribution(input: PromptContributionActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one Memory search lifecycle state without query or result content.
 * @param input - Session sequence and sanitized lifecycle state.
 * @returns sanitized best-effort append outcome.
 */
memorySearch(input: MemoryActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one Memory read lifecycle state without a path or returned content.
 * @param input - Session sequence and sanitized lifecycle state.
 * @returns sanitized best-effort append outcome.
 */
memoryRead(input: MemoryActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one Memory flush lifecycle state without prompt or reply content.
 * @param input - Session sequence and sanitized lifecycle state.
 * @returns sanitized best-effort append outcome.
 */
memoryFlush(input: MemoryActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one admitted inbound channel message without platform identities or text.
 * @param input - Adapter, direct/group class, mention fact, and Session sequence.
 * @returns sanitized best-effort append outcome.
 */
channelReceived(input: ChannelReceivedActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one newly committed delivery state without delivery or platform identities.
 * @param input - Adapter, conversation class, mention fact, Session sequence, and sanitized state; omit state for an ambiguous receipt.
 * @returns sanitized best-effort append outcome.
 */
channelDelivery(input: ChannelDeliveryActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record a skill catalog projection without catalog entries or provider locations.
 * @param input - Visible entry count and source Session sequence.
 * @returns sanitized best-effort append outcome.
 */
skillCatalog(input: SkillCatalogActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record a selected skill identity without skill text or provider location.
 * @param input - Skill identity and source Session sequence.
 * @returns sanitized best-effort append outcome.
 */
skillLoaded(input: SkillLoadedActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record a skill invocation lifecycle state without arguments, output, or errors.
 * @param input - Skill identity, source Session sequence, and sanitized lifecycle state.
 * @returns sanitized best-effort append outcome.
 */
skillInvoked(input: SkillInvokedActivity): Promise<ClawdshActivityWriteResult>

/**
 * Record one automation run state without prompt, model output, or error text.
 * @param input - Rule identity, schedule time, source Session sequence, and sanitized lifecycle state.
 * @returns sanitized best-effort append outcome.
 */
automationRun(input: AutomationRunActivity): Promise<ClawdshActivityWriteResult>

/**
 * Read bounded package-owned sidecars without exposing physical paths or filesystem diagnostics.
 * @param request - Session and optional fixed producer subset.
 * @returns canonical records with sanitized availability/degradation state.
 */
list(request: ClawdshActivityReadRequest): Promise<ClawdshActivityReadResult>

/**
 * Merge standard Session history with sidecars and return one cursor-paginated semantic page.
 * @param request - Session, category filter, ordering, limit, and optional continuation.
 * @param history - Live events or persisted inspection supplied by the trusted Host caller.
 * @returns a stable page with sanitized source availability and warnings.
 */
async page( request: ClawdshActivityPageRequest, history: ClawdshActivityHistorySources = {}, ): Promise<ClawdshActivityPage>
```

Types: [AutomationRunActivity](../../packages/openclaw/activity/README.md) · [ChannelDeliveryActivity](../../packages/openclaw/activity/README.md) · [ChannelReceivedActivity](../../packages/openclaw/activity/README.md) · [ClawdshActivityHistorySources](../../packages/openclaw/activity/README.md) · [ClawdshActivityPage](../../packages/openclaw/activity/README.md) · [ClawdshActivityPageRequest](../../packages/openclaw/activity/README.md) · [ClawdshActivityReadRequest](../../packages/openclaw/activity/README.md) · [ClawdshActivityReadResult](../../packages/openclaw/activity/README.md) · [ClawdshActivityWriteResult](../../packages/openclaw/activity/README.md) · [MemoryActivity](../../packages/openclaw/activity/README.md) · [PromptContributionActivity](../../packages/openclaw/activity/README.md) · [SkillCatalogActivity](../../packages/openclaw/activity/README.md) · [SkillInvokedActivity](../../packages/openclaw/activity/README.md) · [SkillLoadedActivity](../../packages/openclaw/activity/README.md)

Source: [`packages/openclaw/activity/src/index.ts:69`](../../packages/openclaw/activity/src/index.ts)

<a id="ctxclawdshopenclawcontrol--clawdshopenclawcontrol"></a>

### `ctx.clawdshOpenClawControl` — `ClawdshOpenClawControl`

Always-mounted validation and status seam for the local ClawDSH control plane.

```ts cordis-catalog
/**
 * Return applied enablement and lifecycle state without platform account or credential data.
 * @returns Sanitized runtime state.
 */
snapshot(): OpenClawControlStatus

/**
 * Validate desired user-owned settings while preserving managed deployment identities.
 * @param desired Complete desired plugin configuration produced by the settings resolver.
 * @returns Completion after every managed file and fail-closed configuration check passes.
 */
async validateDesired(desired: Config): Promise<void>

/** Record successful Gateway and Provider startup. */
markActive(): void

/** Record an unexpected post-handshake Gateway exit without exposing process diagnostics. */
markFailed(): void
```

Types: [OpenClawControlStatus](../../packages/openclaw/channel-openclaw/README.md)

Source: [`packages/openclaw/channel-openclaw/src/index.ts:65`](../../packages/openclaw/channel-openclaw/src/index.ts)

<a id="ctxclawdshsoulsettings--soulsettingshost"></a>

### `ctx.clawdshSoulSettings` — `SoulSettingsHost`

Host-owned Soul settings registration. Agent-scope Soul rows query it once at mount, so a committed change affects only subsequently mounted sessions.

```ts cordis-catalog
/**
 * Resolve one new agent scope from its preset entry plus the current user layer.
 * @param entry - Soul entry from the agent preset being mounted.
 * @returns the immutable-at-session-mount Soul settings snapshot.
 */
forSession(entry: Config): Config
```

Source: [`packages/openclaw/soul/src/index.ts:116`](../../packages/openclaw/soul/src/index.ts)

<a id="ctxembeddings--embeddings-abstract-seam"></a>

### `ctx.embeddings` — `Embeddings` (abstract seam)

Abstract text-embedding service. Subclass, implement embed, and load the subclass as a plugin — it registers as `ctx.embeddings` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- embed returns exactly one vector per input text, in input order, and all vectors of one call share one dimension. Providers may additionally promise dimension stability across calls; the Ark provider does and fails loudly on drift.
- Every vector is a non-empty list of finite numbers.
- Any failure — missing credential, network error, malformed or partial response — rejects the whole call; implementations never return partial results.
- The `signal` cancels the call where the backend can honor it (network round-trips); cooperative tool timeouts pass their deadline through it.

```ts cordis-catalog
/**
 * Embed each input text into one dense vector in the provider's embedding space.
 * @param texts - the texts to embed; empty input embeds to an empty result.
 * @param signal - optional cancellation signal for the underlying request.
 * @returns one {@link EmbeddingVector} per input text, in input order.
 */
abstract embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]>
```

Types: [EmbeddingVector](../adr/0003-embeddings-seam.md)

Source: [`packages/openclaw/embeddings/src/index.ts:46`](../../packages/openclaw/embeddings/src/index.ts)
<!-- END GENERATED cordis-surface -->
