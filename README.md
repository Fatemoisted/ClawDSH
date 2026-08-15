# ClawDSH

English | [中文](README.zh.md)

> **OpenClaw's personal-assistant capabilities, rebuilt as composable plugins on the DeepSeek Harness (`dsh`) Cordis foundation.**

ClawDSH keeps the Harness runtime intact and adds a separately owned plugin layer. Product code lives in [`packages/openclaw/`](packages/openclaw/README.md), assembly lives in [`tools/openclaw-preset-openclaw/`](tools/openclaw-preset-openclaw/README.md), and project decisions live under `docs/{adr,specs,matrix,standards,journal}/`. The upstream `vendor/`, `packages/*` other than `openclaw/`, `apps/`, `website/`, and upstream documentation remain read-only.

## Quick start from a source checkout

Prerequisites are Node.js 22.19 or later within the 22.x line, or Node.js 24 or later. The repository pins pnpm 11.7.0. Run these commands from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
tools/link-openclaw.sh
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk_xxx
pnpm dsh --profile openclaw
```

The installed `openclaw` profile is a resident Feishu channel daemon, not the Web UI or a one-shot headless runner. It uses `$DSH_HOME` or `~/.dsh` by default; use the same `DSH_HOME` for both `tools/link-openclaw.sh` and `pnpm dsh`. Telegram, Discord, and automation are installed but disabled in the default profile. The link script is the pre-publication development path and refreshes the installed profile from the current checkout. Follow the [Telegram credentialed-e2e cookbook](docs/cookbook/telegram-e2e.md) to enable and verify Telegram without putting its token in the repository.

This keyless check validates profile composition without connecting to Feishu, then runs the ClawDSH package tests:

```bash
FEISHU_APP_ID=cli-smoke FEISHU_APP_SECRET=smoke \
  pnpm dsh --profile openclaw --dump-config
pnpm run test:openclaw
```

`--dump-config` proves only that the composition resolves. Platform permissions, credentials, and network connectivity still require a deployed end-to-end check.

## Telegram real-client result (2026-08-15)

The credentialed run against the real Telegram Bot API and clients passed authentication, private-chat `/start` and exact replies, durable Memory across restart, group mention/reply gates, addressed-command isolation, Harness `web_search`, offline catch-up, Unicode-safe long-reply splitting, interrupted-turn recovery, and same-chat FIFO delivery. The run also observed caption relay and bodyless-media ignore behavior on the then-tested pre-image-ingestion build.

The image materialization and text-only image paths were added after that run and have keyless automated coverage only; they are not credentialed real-client passes. Credential rotation, chat-id migration, forum topics, and acknowledgement reactions likewise remain outside the recorded live baseline. See the [Telegram credentialed-e2e cookbook](docs/cookbook/telegram-e2e.md) and [2026-08-15 journal](docs/journal/2026-08-15.md) for the exact evidence boundary.

## Harness contracts first

Ordinary ClawDSH development starts from Harness contracts and existing components, not a fresh traversal of implementation source. Use this reading order:

| Need | Authoritative entry |
|---|---|
| Runtime composition, turn flow, sessions, and extension points | [Harness architecture](docs/architecture.md) |
| Complete package inventory, dependency graph, and package-group overview | [Harness module entry](docs/matrix/harness-reuse.md#harness-module-entry) |
| Service, event, and public type contracts | [Subsystem reference](docs/subsystems/README.md) |
| Dependency, capability, event, tool, and configuration graphs | [Documentation graph index](docs/graph-atlas.md) |
| How each ClawDSH package reuses Harness | [Harness reuse map](docs/matrix/harness-reuse.md) |
| ClawDSH package configuration and limitations | [Owned package roster](packages/openclaw/README.md) |

Consume documented `ctx.*` services, events, and public types; do not import or copy a concrete Harness provider. Read owning source only when diagnosing an internal bug, security/concurrency/performance behavior, an undocumented contract, a missing seam, or an upstream breaking change. A missing contract discovered that way must be added to the owning documentation or an ADR. The binding rule is in the [plugin contract](docs/standards/plugin-contract.md), with rationale in [ADR-0006](docs/adr/0006-harness-contract-first.md).

## Project references

- [Purpose and roadmap](docs/specs/roadmap.md)
- [OpenClaw feature alignment](docs/matrix/parity.md)
- [Architecture decisions](docs/adr/)
- [Development standards](docs/standards/)
- [OpenClaw profile and credentials](tools/openclaw-preset-openclaw/README.md)

## Development checks

Documentation and package changes should run the narrow owning checks before a push:

```bash
pnpm run test:openclaw
pnpm exec tsc -p packages/openclaw/tsconfig.check.json
pnpm run doc-sync
pnpm run lint
```

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
