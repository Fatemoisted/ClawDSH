# Plugin contract specification (plugin-contract)

English | [中文](plugin-contract.zh.md)

> This spec is the constitution of ClawDSH plugin development: all owned code obeys it, and every community PR is gated by it. Theoretical foundation: dsh's Cordis framework (`docs/cordis-primer.md`, `docs/capability-seams.md`).

## 1. Basic form

- One feature = one package (`packages/openclaw/<pkg>/`), named `@clawdsh/dsh-<kebab-case>`;
- A plugin = one Cordis plugin: `inject` declares dependencies + `apply(ctx)` mounts; manual bootstrapping order is forbidden;
- Start by copying `tools/openclaw-plugin-template/`, then register following the onboarding flow in `packages/openclaw/README.md`.

## 2. Dependency declaration (inject)

- Depend only on seam service keys (`ctx.tools`, `ctx.llm`, `ctx.sessions`…); **cross-package import of concrete implementations is forbidden**;
- Dependencies are a contract: the inject list only grows, never shrinks; removing a dependency counts as a breaking change and requires a migration note in the package README.

## 3. Events and effects

- Observe with `emit`, intercept/policy with `waterfall`/`serial`, dispatch with `parallel`;
- Every registration must be reversible: `ctx.effect()` / `ctx.on()` return a disposer, and teardown rolls back automatically; put related registrations for one feature in the same effect to guarantee rollback order;
- No global side effects: no global variables, no monkey-patching, no dependence on process startup order.

## 4. Log invariant (highest priority)

- **"model-visible means logged"**: anything that enters the model's view (channel messages, memory retrieval results, skill content) must be reconstructable from the session log;
- A plugin's durable data goes through either session events or a declared persistence seam; private side-channel storage is forbidden.

## 5. New seam admission

Adding a `ctx.*` service is the highest-cost change, and the process is mandatory:

1. Write an ADR (template at the top of `docs/adr/0001-project-foundation.md`);
2. Give the contract draft in the ADR (interface + minimal surface);
3. **upstream-first (with exceptions)**: by default first PR to the dsh upstream, with a local profile patch as the bridge; but the sponsor decided on 2026-08-14 to skip the upstream PR and move fast (see ADR-0002 decision 4), keeping `ctx.channels` as a ClawDSH-owned seam for the long term;
4. Before a new seam is approved, the feature is frozen and must not be bypassed.

## 6. Contract tests (merge gate)

Every package must provide:

- **Contract tests**: exercise the minimal behavior surface of the seam interface it implements (mount → behavior → teardown rollback);
- **profile smoke test**: `pnpm dsh --profile openclaw --dump-config` resolves the package's mount line;
- Channel-type plugins: one end-to-end session test of one inbound → one outbound (the channel API may be mocked).

## 7. Public-surface changes

- Changes to a package's external API (exports, service keys, event names) must be recorded in the README's change-note section;
- Follow the upstream convention: changing public behavior updates the owning README/JSDoc in the same change.

## 8. OpenClaw feature porting principle (look at the implementation first, then integrate into Cordis)

When porting an OpenClaw feature to dsh, the order is fixed as **look at the upstream implementation first, then design the Cordis integration**:

1. **First read how the OpenClaw upstream implements it**: locate the feature's origin in the OpenClaw source repo (`src/`, `extensions/<name>/`, baseline origins in `docs/matrix/parity.md`), and work out which official SDK/dependency it uses, which events it subscribes to, which permissions/scopes it requests, and which boundaries it handles (idempotency, dedup, rate limiting, long connection vs webhook);
2. **Then choose the Cordis integration form**: decide which existing seam it lands on (or add a seam via the section 5 ADR process), and following section 1 "one feature = one package", section 2 dependency declaration, and section 4 log invariant, deliver a minimal-surface adapter;
3. **Prefer reusing the SDKs/dependencies the upstream has proven**: adopt the libraries the upstream already de-risked (Feishu `@larksuiteoapi/node-sdk`, Telegram `grammy`) first, and **never hand-roll the low-level protocol** — unless the upstream has no corresponding SDK and hand-writing would cut substantial code. This is both "prefer maintained dependencies over hand-rolling" and avoiding repeating the pitfalls the upstream already hit.

Motivation: OpenClaw's channel integration has a large amount of non-obvious ceremony (permissions, long connection, event format, idempotency), and hand-rolling it is error-prone; reading the upstream implementation first inherits these already-proven decisions, then trims them into a minimal Cordis surface.

## 9. Harness reuse principle (contracts first, source when needed)

The OpenClaw implementation establishes provider behavior; the Harness side uses a different reading order:

1. Start with the [Harness architecture](../architecture.md), owning [subsystem page](../subsystems/README.md), generated [graph index](../graph-atlas.md), package README, and the [ClawDSH reuse map](../matrix/harness-reuse.md).
2. Reuse documented `ctx.*` services, events, public types, utilities, and existing providers through their contracts. Do not import or copy a concrete Harness provider to inherit its implementation.
3. Inspect the owning Harness source only for an internal bug, security/concurrency/performance behavior, an undocumented contract, a missing seam, or an upstream breaking change. If the missing contract affects future integration, document it in the same change.
4. When no existing seam fits, follow section 5 and stop at an ADR instead of building a private parallel core. [ADR-0006](../adr/0006-harness-contract-first.md) owns the rationale.
