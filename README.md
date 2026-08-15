# ClawDSH

English | [中文](README.zh.md)

> **OpenClaw's personal-assistant capabilities, rebuilt as composable plugins on the DeepSeek Harness (`dsh`) Cordis foundation.**

ClawDSH keeps the Harness runtime intact and adds a separately owned plugin layer. Product code lives in [`packages/openclaw/`](packages/openclaw/README.md), assembly lives in [`packages/openclaw/preset-openclaw/`](packages/openclaw/preset-openclaw/README.md), and project decisions live under `docs/{adr,specs,matrix,standards,journal}/`. Upstream-owned source remains read-only.

## Quick start from a source checkout

Use Node.js 22.19 or later within the 22.x line, or Node.js 24 or later. The repository pins pnpm 11.7.0.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

The profile serves the ClawDSH product shell at `/clawdsh/` and keeps stock dsh Web at `/` as Harness Advanced; both share one Host, Session store, and Connection transport. New Sessions use the `clawdsh` preset displayed as `ClawDSH 模式`. Use the same `DSH_HOME` for the link script and `dsh`. Memory and Skills are available; Automation, the canonical OpenClaw communication sidecar, and the retained legacy-channel group are disabled in a clean installation. A model credential is needed only when a conversation makes a model request.

```bash
pnpm dsh --profile clawdsh --dump-config
pnpm run test:openclaw
```

`--dump-config` proves only that composition resolves. Platform permissions, credentials, and network delivery require a scoped end-to-end check.

## Channel status: sidecar is canonical, disabled, and uncertified

[ADR-0008](docs/adr/0008-openclaw-channel-plane.md) makes a locked OpenClaw Gateway sidecar the communication-plane owner. The production catalog records 27 transports (**24+3**), but catalog presence is not runtime support: every sidecar Channel remains `cataloged`, default-disabled, and neither `certified` nor `enabled`. Follow the [channel sync standard](docs/standards/openclaw-channel-sync.md) for assembly and certification.

The in-process Telegram, Discord, and Feishu adapters remain only in a separate default-disabled `clawdsh-legacy-channel-plane` compatibility group. If legacy opt-in is present, Gateway startup and Settings preflight reject enabling the canonical sidecar. The two paths must never use the same platform account.

Historical credentialed evidence is deliberately scoped to that legacy path: Feishu text completed a real round trip on 2026-08-14, and Telegram completed real Bot API/client direct and group text/caption, Harness `web_search`, restart/recovery, offline catch-up, Unicode splitting, and same-chat FIFO checks on 2026-08-15. Discord has keyless coverage but no real-server E2E. These results do not certify the sidecar. See the [Telegram legacy E2E cookbook](docs/cookbook/telegram-e2e.md) and [evidence journal](docs/journal/2026-08-15.md).

## Harness contracts first

Ordinary ClawDSH development starts from Harness contracts and existing components, not a fresh traversal of implementation source:

| Need | Authoritative entry |
|---|---|
| Runtime composition, turn flow, Sessions, and extension points | [Harness architecture](docs/architecture.md) |
| Complete package inventory and dependency graph | [Harness module entry](docs/matrix/harness-reuse.md#harness-module-entry) |
| Services, events, and public types | [Subsystem reference](docs/subsystems/README.md) |
| Capability, event, tool, configuration, and lifecycle graphs | [Documentation graph index](docs/graph-atlas.md) |
| How each ClawDSH package reuses Harness | [Harness reuse map](docs/matrix/harness-reuse.md) |

Consume documented `ctx.*` services, events, and public types; do not import or copy a concrete Harness provider. Read owning source when diagnosing an internal bug, security/concurrency/performance behavior, an undocumented contract, a missing seam, or an upstream breaking change. The binding rule is in the [plugin contract](docs/standards/plugin-contract.md), with rationale in [ADR-0010](docs/adr/0010-harness-contract-first.md).

Project references: [roadmap](docs/specs/roadmap.md) · [status matrix](docs/matrix/parity.md) · [architecture decisions](docs/adr/) · [development standards](docs/standards/)

---

<!-- ⬇ 以下为上游 README 原文（勿改；rebase 冲突时以 upstream 为准） -->

# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
