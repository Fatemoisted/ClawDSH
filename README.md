<!-- ═══════════════ ClawDSH PUBLIC LANDING START ═══════════════ -->

# ClawDSH

English | [中文](README.zh.md)

<p align="center"><img src="packages/openclaw/preset-openclaw/brand/clawdsh-lockup.svg" alt="ClawDSH — Tidal Claw whale mark" width="520"></p>

> **OpenClaw capabilities, rebuilt as composable dsh plugins.**

ClawDSH is a local personal-assistant product built on the DeepSeek Harness (`dsh`) plugin runtime. It preserves the native Harness application for advanced use while adding an opinionated product profile, memory, skills, automation, privacy-limited activity records, and an optional OpenClaw communication plane.

ClawDSH is an independent community project. It is built on DeepSeek Harness and interoperates with OpenClaw, but it is not endorsed by or affiliated with either project. This release is `0.1.0-rc.1`: use the `next` npm tag, expect release-candidate changes, and do not treat it as a stable compatibility promise.

## How the projects relate

| Project | Role in ClawDSH | What remains independently owned |
|---|---|---|
| ClawDSH | Product profile, owned plugins, managed installer, `/clawdsh/` UI, and the Tidal Claw brand | ClawDSH settings, release lifecycle, and community support |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Cordis-based agent runtime, model/tool/session services, and the native Web application | Upstream source, native UI, and the `dsh` architecture |
| [OpenClaw](https://github.com/openclaw/openclaw) | Optional communication-plane runtime and platform account owner | Platform adapters, accounts, credentials, policy, and state |

The ClawDSH repository tracks DeepSeek Harness as the `upstream` Git remote. The [Harness context and reuse map](docs/specs/context-map.md) explains the reused dsh capability seams; the [roadmap](docs/specs/roadmap.md) and [parity matrix](docs/matrix/parity.md) describe ClawDSH-owned work.

## Features and safe defaults

| Feature | User-visible behavior | Clean-install state |
|---|---|---|
| ClawDSH mode | New product sessions use the `clawdsh` preset and open in the native dsh conversation UI | Enabled |
| Soul | Adds the personal-assistant prompt layer; edits apply to new sessions | Enabled |
| Memory and Ark recall | Stores Markdown memory under `$DSH_HOME/memory`; Ark embeddings add optional semantic recall | Memory enabled; Ark key optional until an embedding call |
| Skills Hub | Loads workspace skills and the compatible `~/.clawdbot/skills` directory | Enabled |
| Automation | Runs scheduled agent work in dedicated sessions | Disabled |
| Activity | Explains selected Soul, Memory, Skill, Channel, and Automation facts without copying secrets or raw platform identities | Enabled and non-blocking |
| OpenClaw Gateway | Provides the locked external communication plane after explicit installation and configuration | Disabled |
| Harness Advanced | Keeps the unmodified upstream application at `/` for presets, raw trajectory, and advanced controls | Available |

The Channel catalog is evidence, not a support claim. Telegram, Feishu, Discord, and other catalog entries are not declared installable, certified, enabled, or ready merely because they appear in the UI. ClawDSH ships no direct platform adapter.

## Quick start

### Requirements

- Node.js `22.19.x` or `>=24.0.0` with npm.
- A local machine on which you trust same-user agent tools. No model or platform key is needed to open the UI.

### Start with npm

```sh
npx --yes @clawdsh/cli@next
```

The command installs or upgrades the managed `clawdsh` profile under `$DSH_HOME` (default `~/.dsh`), then starts the foreground Web Host. Open the printed URL, normally `http://127.0.0.1:3080/clawdsh/`. Press `Ctrl-C` to stop it; the launcher forwards terminal signals and waits for dsh to close.

The first run creates only installer-owned profile, preset, dependency, and management files. It does not require or create an OpenClaw runtime, platform login, model key, Memory fact, Automation rule, or external Channel listener. See the [complete CLI reference](packages/openclaw/preset-openclaw/distribution/cli/README.md) for global installation, custom host/port values, upgrades, migration, backups, and failure behavior.

## Credentials

ClawDSH separates model, embedding, and platform credentials so one UI or file never becomes an all-secrets store.

| Credential | Where to set it | When it is needed | Effect timing |
|---|---|---|---|
| DeepSeek `DEEPSEEK_API_KEY` | Settings → Models; `$DSH_HOME/.credentials.yaml`; launch environment; or `.env` | The first DeepSeek model or Web Search request | Managed credential file: next call; environment and `.env`: restart |
| Ark `ARK_API_KEY` | Settings → ClawDSH → Memory → Ark; `$DSH_HOME/.credentials.yaml`; launch environment; or `.env` | The first Ark embedding request | Managed credential file: next call; environment and `.env`: restart |
| Platform account credentials | OpenClaw account setup and `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` after `clawdsh channel install` | Only an explicitly enabled OpenClaw platform route | OpenClaw-owned; restart after account or policy changes |

The local managed credential document is ordinary YAML:

```yaml
DEEPSEEK_API_KEY: "<your-deepseek-key>"
ARK_API_KEY: "<your-ark-key>"
```

Credential precedence is inherited launch environment → `$DSH_HOME/.credentials.yaml` → the invoking directory's `.env` → `$DSH_HOME/.env`. The UI never returns secret values through Settings RPC, and ClawDSH never copies OpenClaw platform credentials into dsh credentials, logs, sessions, Activity, or its management marker.

`$DSH_HOME/.credentials.yaml` is stored with owner-only permissions. Mode `0600` protects against other operating-system users; it cannot stop a shell or filesystem tool running under the same UID from deliberately reading the file. Run ClawDSH only on a trusted host, keep secrets out of `settings.yaml`, profile patches, issue reports, and screenshots, and secure any backup that contains the credential document.

## Configuration and data

### Four configuration domains

| Domain | Authoritative location | User entry and precedence | Ownership rule |
|---|---|---|---|
| Non-secret product settings | `$DSH_HOME/settings.yaml` | Settings → ClawDSH; schema defaults → managed profile base → user settings | ClawDSH exposes exactly eight product namespaces and classifies every field as editable, managed, or hidden |
| Model and Ark secrets | `$DSH_HOME/.credentials.yaml`, launch environment, and `.env` | Settings → Models or Memory → Ark; environment wins over the managed file and both `.env` layers | Secret values never belong in `settings.yaml` or a profile patch |
| Deployment composition and advanced overrides | Installed bundle plus `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` and the home-level `$DSH_HOME/cordis.patch.yml` | Bundle layers → profile patch → home patch; later layers win | The installer owns the bundle and dependency tree but preserves user patch bytes |
| OpenClaw accounts and policy | `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` | `clawdsh channel install`, then OpenClaw account and policy tools | OpenClaw owns platform state; ClawDSH validates deployment identity but does not duplicate the state |

The Settings page displays each field's owner and effect timing. `live` changes affect the mounted runtime, `new-session` changes require a new conversation, `next-call` changes are resolved for the next operation, and `restart` changes take effect after restarting ClawDSH. Soul is new-session scoped; Automation settings apply live; Memory and Skills provider changes require restart; managed credential-file changes are visible on the next call. The [generated configuration catalog](docs/config-catalog.md) is the exhaustive field reference; README examples intentionally cover only common entries.

### Data locations and backups

| Data | Default location | Managed install or migration behavior |
|---|---|---|
| Settings and credentials | `$DSH_HOME/settings.yaml`, `$DSH_HOME/.credentials.yaml` | Never read, moved, or rewritten by source migration; Settings writes only the selected user namespace |
| Sessions | `$DSH_HOME/sessions` | Preserved across install, upgrade, preset reset, and source migration |
| Memory and Activity | `$DSH_HOME/memory`, `$DSH_HOME/clawdsh/activity/v1` | Preserved; Activity remains privacy-limited and non-blocking |
| Managed profile and presets | `$DSH_HOME/profiles/clawdsh`, `$DSH_HOME/.agent-presets/{clawdsh,clawdsh-messaging-safe}` | Installer-owned; modified presets require an explicit backup-before-reset action |
| OpenClaw runtime and state | `$DSH_HOME/clawdsh/channel/openclaw` | Acquired only by `channel install`; existing configuration and state are preserved |
| Compatible managed skills | `~/.clawdbot/skills` | Outside `$DSH_HOME` by default; set Skills Hub `managedDir` to choose another directory |

For a complete operator backup, stop ClawDSH and snapshot the entire `$DSH_HOME` plus `~/.clawdbot/skills` or the configured external `managedDir`. Installer-created source-migration and preset backups cover only the named profile/preset assets; they are not substitutes for a user-data backup. Restore a full snapshot only while ClawDSH is stopped, preserve owner-only permissions, and run `npx --yes @clawdsh/cli@next doctor` before starting.

## Maintenance and troubleshooting

### Update, diagnose, and migrate

```sh
npx --yes @clawdsh/cli@next
npx --yes @clawdsh/cli@next doctor
npx --yes @clawdsh/cli@next migrate source
npx --yes @clawdsh/cli@next migrate source --apply
npx --yes @clawdsh/cli@next migrate source --apply --backup-modified
npx --yes @clawdsh/cli@next channel install
npx --yes @clawdsh/cli@next channel doctor
```

Running the `next` entry again installs the current release candidate and performs an idempotent managed upgrade. `doctor` checks only the installer-owned profile, bundle, and presets; `channel doctor` checks the separately managed OpenClaw runtime. Neither command reads credential stores.

`clawdsh migrate source` is read-only and reports whether an older source-linked installation is a recognized clean or modified layout. `--apply` backs up a recognized clean layout and migrates it; modified source-owned patch, preset, or extra profile entries require `--apply --backup-modified`. Unknown, incomplete, mixed-checkout, non-symlink, or different-package layouts always fail closed. Migration publishes `.clawdsh.json` last and rolls back on failure without reading or moving Settings, credentials, Memory, Sessions, Skills, Activity, or OpenClaw state.

### Common failures

| Symptom | Check |
|---|---|
| The UI opens but a model request fails | Configure `DEEPSEEK_API_KEY`; startup is intentionally keyless, model use is not |
| Semantic Memory reports a missing Ark key | Configure `ARK_API_KEY`, or use Memory without Ark semantic recall |
| `init` refuses an existing `clawdsh` profile | Run the printed `migrate source` inspection command; unknown unmarked assets are never adopted |
| A managed preset was modified | Save the changes separately, then use `clawdsh init --reset-preset` to create a timestamped backup and restore the managed preset |
| `doctor` reports an interrupted transaction | Rerun the same management command; recovery runs before later work and never claims a partial install as managed |
| The port is in use | Start with `--port <port>`; only `--host`, `--port`, and repeatable `--trusted-host` are accepted Web flags |
| Gateway enablement fails | Run `channel install` and `channel doctor`, then complete OpenClaw-owned account and policy setup; a catalog entry alone is not support evidence |

## Source development and project policy

A fresh checkout uses an isolated source-development home, never the public `~/.dsh` home:

```sh
git clone https://github.com/Fatemoisted/ClawDSH.git
cd ClawDSH
pnpm install
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/run-clawdsh-dev.sh
```

`CLAWDSH_DEV_HOME` defaults to `~/.clawdsh-dev`; the source wrapper refreshes the development links and then exports that path as `DSH_HOME`. Its private development bundle carries product composition, while the profile `cordis.patch.yml` is created empty and preserved byte-for-byte on later refreshes. See the [assembly guide](packages/openclaw/preset-openclaw/README.md) for advanced Gateway provisioning and source lifecycle details.

- Support and bug reports: [GitHub Issues](https://github.com/Fatemoisted/ClawDSH/issues).
- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). ClawDSH-owned changes follow the repository's upstream-read-only policy.
- License: [MIT](LICENSE), retaining DeepSeek Harness notices and adding ClawDSH contributors.
- Brand: the original [Tidal Claw assets and guide](packages/openclaw/preset-openclaw/brand/README.md) use a whale as the primary form and a coral claw as a secondary detail; they do not reproduce either upstream logo.

<!-- ════════════════ ClawDSH PUBLIC LANDING END ════════════════ -->

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
