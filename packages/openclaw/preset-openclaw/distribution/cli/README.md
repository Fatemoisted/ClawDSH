# `@clawdsh/cli`

English | [中文](README.zh.md)

`@clawdsh/cli` installs, verifies, upgrades, and launches the local ClawDSH product through exact dependencies on `@deepseek-ai/dsh@0.1.0-rc.6` and `@clawdsh/dsh-bundle@0.1.0-rc.1`. It is a release candidate: use the npm `next` tag, and expect its command and on-disk formats to change before a stable release.

## Requirements and installation

The supported Node.js engine is `22.19.x` or `>=24.0.0`. Opening the UI is keyless; a model key is required only when a model-backed operation runs.

Run without a global installation:

```sh
npx --yes @clawdsh/cli@next
```

Or install the current release candidate globally:

```sh
npm install --global @clawdsh/cli@next
clawdsh
```

Both entry points perform an idempotent managed initialization or upgrade, then start the `clawdsh` profile. The default Harness home is `~/.dsh`; set `DSH_HOME` before the command to select a different absolute or `~/...` location. The ready line prints the product URL, normally `http://127.0.0.1:3080/clawdsh/`.

## Command reference

| Command | Behavior |
|---|---|
| `clawdsh` | Initialize or upgrade the managed product, then start it in the foreground |
| `clawdsh init` | Initialize or upgrade without starting dsh |
| `clawdsh init --reset-preset` | Back up each unmarked or modified managed-name preset, then restore the release copy |
| `clawdsh start` | Start the existing `clawdsh` profile without installing or repairing it |
| `clawdsh start --profile <name>` | Start another profile without adopting or modifying it |
| `clawdsh doctor` | Verify the management marker and installer-owned profile, bundle, and presets |
| `clawdsh migrate source` | Inspect an older source-linked ClawDSH installation without persistent writes |
| `clawdsh migrate source --apply` | Back up and migrate a recognized clean source installation |
| `clawdsh migrate source --apply --backup-modified` | Back up and migrate a recognized layout whose source-owned assets were modified |
| `clawdsh channel install` | Explicitly acquire and assemble the locked production OpenClaw runtime |
| `clawdsh channel doctor` | Verify the managed OpenClaw artifact, runtime, bridge, Node engine, and fail-closed policy |
| `clawdsh --help`, `clawdsh --version` | Print the command help or CLI release-candidate version |

`--backup-modified` is valid only with `--apply`. Start commands accept `--host <host>`, `--port <port>`, and repeatable `--trusted-host <host>`; `--host` and `--port` may each appear once. Unknown commands, flags, missing values, invalid profile names, and all other dsh arguments fail before launch.

## Installation, upgrade, and reset

Initialization owns these paths under `$DSH_HOME`:

- `profiles/clawdsh/package.json` and its installed `node_modules` dependency tree;
- `.agent-presets/clawdsh` and `.agent-presets/clawdsh-messaging-safe`;
- `.clawdsh.json`, the public management marker.

The profile dependency order is fixed as `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`. Installation uses the public npm registry, disables lifecycle scripts, removes ambient key/secret/token/password variables from the npm subprocess, and accepts no user registry override.

The installer stages and validates a complete candidate before replacing managed paths. A private transaction journal moves existing managed targets aside, publishes the candidate, and writes `.clawdsh.json` last. A later management command recovers an interrupted transaction before doing new work. Concurrent mutating commands fail on the management lock rather than interleave.

The profile's `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` is a user layer. A fresh installation creates it empty with owner-only permissions; an ordinary upgrade replaces the managed manifest and dependency tree but preserves that patch byte-for-byte. The installer also leaves Settings, credentials, Sessions, Memory, Skills, Activity, OpenClaw configuration, and OpenClaw state untouched.

An unmarked same-name profile is never adopted. An unmarked or modified preset blocks ordinary initialization because it may contain user work. `init --reset-preset` first copies each affected preset to `.agent-presets/<id>.backup-<timestamp>-<digest>/`, then restores the release copy. This flag does not reset `settings.yaml`, credentials, Memory, Sessions, OpenClaw state, or the user profile patch; namespace settings are reset from the Settings UI.

To update a global installation, install the new `next` version and run the integrity check:

```sh
npm install --global @clawdsh/cli@next
clawdsh init
clawdsh doctor
```

The no-install `npx --yes @clawdsh/cli@next` entry resolves the current `next` version and performs the same managed upgrade. ClawDSH does not publish or document a stable npm `latest` entry for this release candidate.

## Launch lifecycle

The CLI launches the `dsh` executable from its exact `@deepseek-ai/dsh` dependency; it never searches `PATH` for another dsh. `start --profile <name>` selects an existing profile but does not mark it as ClawDSH-managed.

While dsh runs, the CLI remains its foreground supervisor. It inherits standard input/output/error, forwards `SIGINT`, `SIGTERM`, and `SIGHUP`, waits for dsh to close, and mirrors the terminal signal. Stopping the wrapper therefore does not intentionally leave a detached Harness process.

## Configuration and credentials

The CLI manages product assembly, not user configuration. The authoritative user domains are:

| Domain | Location |
|---|---|
| Non-secret product settings | `$DSH_HOME/settings.yaml` |
| DeepSeek and Ark credentials | `$DSH_HOME/.credentials.yaml`, inherited environment, and `.env` layers |
| Advanced composition override | `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` |
| OpenClaw platform accounts and policy | `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` |

`doctor` reads installer-owned metadata and filesystem identities only; it does not open the credential store. Channel commands preserve platform credential values and do not return or log credential fields. The [root configuration and key guide](../../../../../README.md#credentials) explains precedence, effect timing, all four domains, and backup scope.

## Source installation migration

The recognized historical ClawDSH source layout contains a profile, two presets, and eleven flat package symlinks in the public `$DSH_HOME`. Ordinary `init` refuses that footprint and prints the exact migration command instead of overwriting it.

Run the inspection first:

```sh
clawdsh migrate source
```

Inspection reads only the historical profile, the two same-name presets, and the known symlinks. It classifies the layout as follows:

| Result | Meaning | Allowed next action |
|---|---|---|
| `ready` | The complete known manifest, patch, presets, package identities, and one-checkout symlink set match | `clawdsh migrate source --apply` |
| `modified` | The layout is known, but a source-owned patch, preset, or additional profile entry differs | `clawdsh migrate source --apply --backup-modified` |
| Unknown/refused | An identity is missing or different, a link is not a symlink, links span checkouts, a public/dev marker exists, or the asset set is incomplete | No takeover; inspect and resolve manually |

Every applied migration creates an owner-only backup at `$DSH_HOME/.clawdsh-backups/source-<UTC timestamp>-<digest>/` before publishing the managed installation. The backup contains the historical `profile/`, both `presets/`, and `source-backup.json` schema v1 with the evidence digest, modified-asset list, and original/resolved target plus package identity for every known symlink.

The migration transaction replaces the recognized profile and presets, removes only the eleven recognized flat links, and publishes the public `.clawdsh.json` marker last. A failure before completion restores the prior targets. Migration never reads, moves, or rewrites `settings.yaml`, `.credentials.yaml`, Sessions, Memory, Skills, Activity, or OpenClaw state.

## Channel runtime

`init` never downloads OpenClaw. `channel install` is the only managed acquisition path. It requires the current Node executable to satisfy the locked Gateway engine, accepts the checked production artifact, verifies SHA-512 and every archive entry, assembles the locked dependency tree with npm `10.9.7` and lifecycle scripts disabled, verifies the installed package and host trees, copies the stable bridge, and creates a credential-free fail-closed OpenClaw configuration only when none exists. Canary evidence cannot enter this path.

WebUI and Gateway use the same compatible Node executable by default; the npm pin is an assembly tool, not a second Node installation. Existing OpenClaw configuration and state are preserved. Add platform accounts and credentials only through OpenClaw-owned setup, then enable the Gateway in ClawDSH Settings and restart.

`channel doctor` verifies the production artifact, runtime dependency set, host tree, bridge, current Node engine, and the Provider-owned fail-closed configuration policy. It does not prove that a platform account is logged in or that a cataloged Channel is installable, certified, enabled, or supported.

## Backup and recovery

- **Operator backup:** while ClawDSH is stopped, snapshot the complete `$DSH_HOME` plus the external Skills Hub `managedDir` (default `~/.clawdbot/skills`). Protect any copy containing `.credentials.yaml` with owner-only access.
- **Preset-reset backup:** `init --reset-preset` saves only the affected preset beside the preset root. It is a recovery copy of user edits, not a replacement for the complete home.
- **Source-migration backup:** the owner-only `.clawdsh-backups/source-*` directory saves only the historical source-owned profile, two presets, and symlink evidence. It deliberately excludes all product data and secrets.
- **Restore:** there is no automatic `clawdsh restore` command. Restore a complete operator snapshot only while the process is stopped and to the same intended home, preserve ownership and permissions, then run `clawdsh doctor`. Recover files from installer-created backups into a separate inspection directory or a new custom preset id; copying an old source profile or modified preset over managed paths will correctly make `doctor` report an integrity difference.

Do not copy `.clawdsh.json` between machines or reconstruct it by hand. The marker asserts the exact local managed assets; use `clawdsh init` to create or repair a managed installation after saving any user-modified preset separately.

## Failure semantics

| Failure | Result |
|---|---|
| Unknown or unmarked same-name asset | Refused without adoption, deletion, or mutation |
| Modified managed preset | Refused unless `init --reset-preset` explicitly requests backup and replacement |
| Modified recognized source installation | Refused unless `--apply --backup-modified` explicitly authorizes complete backup and migration |
| Unknown source layout | Always refused; no force flag exists |
| Invalid bundle, dependency, archive, path, symlink, digest, or Node engine | Fails closed before the affected managed state is published |
| Interrupted multi-path transaction | Rolled back immediately when possible and recovered before the next management command |
| dsh launch error or nonzero exit | Reported as a nonzero CLI exit; unsupported arguments never pass through |

All diagnostics name the failed subject and correction without printing secret values. The CLI never silently downgrades, adopts a foreign profile, repairs a modified preset, or enables a Channel.

## Model Experience

None. This package installs and launches Host assets without adding model-visible context.

#### KV Cache effect

None. Installation, migration, and diagnostics do not create model requests or change an active Session's request prefix.

## Known Limitations and Deferred Work

- **Release-candidate disk formats may change** — `.clawdsh.json` and source-backup manifest schema v1 have no stable-version compatibility promise yet.
- **No automatic uninstall or restore command** — ownership is deliberately fail-closed; operator snapshots and explicit file recovery remain the recovery path.
- **Production Channel runtime is platform-locked** — unsupported operating-system, architecture, Node-engine, artifact, or dependency combinations fail closed.
- **Catalog presence is not platform support** — live platform use still requires OpenClaw-owned credentials and separate installability, authentication, and certification evidence.
