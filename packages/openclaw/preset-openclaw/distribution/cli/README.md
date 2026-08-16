# `@clawdsh/cli`

English | [中文](README.zh.md)

`@clawdsh/cli` installs, verifies, and launches the local ClawDSH product through its exact `@deepseek-ai/dsh@0.1.0-rc.6` dependency. The package is a release candidate; its on-disk management format may change before the first stable release.

## Commands

```text
clawdsh
clawdsh init
clawdsh init --reset-preset
clawdsh start
clawdsh start --profile <name>
clawdsh doctor
clawdsh channel install
clawdsh channel doctor
```

The no-argument command performs an idempotent managed initialization and starts the `clawdsh` profile. `start --profile <name>` only starts the named profile and never takes ownership of it. Start commands accept `--host`, `--port`, and repeatable `--trusted-host`; no other arguments pass through to dsh. While dsh runs, the CLI remains its foreground supervisor: it forwards `SIGINT`, `SIGTERM`, and `SIGHUP`, waits for dsh to close, and mirrors the terminal signal so shutdown does not leave a detached Harness process.

## Managed data

Initialization owns the `clawdsh` profile manifest and installed profile dependencies, the `clawdsh` and `clawdsh-messaging-safe` presets, and `$DSH_HOME/.clawdsh.json`. It stages and validates a complete candidate before publishing these assets and writes the marker last. An abandoned transaction rolls back on the next command.

The installer never replaces the profile's `cordis.patch.yml`, Settings, credentials, memory, skills, OpenClaw configuration, or OpenClaw state. It refuses any unmarked same-name profile or preset. `init --reset-preset` may replace an unmarked or changed preset only after copying it to a timestamped, digest-labelled backup. Legacy `openclaw` assets produce warnings and remain untouched.

Profile dependency installation uses the public npm registry fixed in the CLI and disables lifecycle scripts. There is no user-facing registry override. The installed profile pins `@deepseek-ai/dsh-base@0.1.0-rc.6`, `@deepseek-ai/dsh-web-app@0.1.0-rc.6`, and `@clawdsh/dsh-bundle@0.1.0-rc.1` in that layer order.

## Channel runtime

`init` does not download OpenClaw. `channel install` is the only managed acquisition path: it first requires the running Node executable to satisfy the locked Gateway engine, accepts the checked production artifact, validates SHA-512 and every tar entry, assembles the checked runtime lock with npm `10.9.7` and scripts disabled, verifies the installed package set and host tree, and creates a credential-free fail-closed configuration only when none exists. WebUI and Gateway use that same Node executable by default; the npm pin is an assembly tool, not a second Node installation. Canary evidence is audit-only and cannot enter this installation path.

The Channel installer preserves existing OpenClaw configuration and state. Platform credentials remain owned by OpenClaw and never enter the ClawDSH marker or command output. `channel doctor` verifies the production artifact, runtime, bridge, current Node engine, and the complete Provider-owned fail-closed configuration policy without selecting, returning, or logging credential fields.

## Model Experience

None, as this package installs and launches Host assets without adding model-visible context.

#### KV Cache effect

None. Installation and diagnostics do not create model requests or change an active Session's request prefix.

## Known Limitations and Deferred Work

- **Production Channel runtime is platform-locked** — installation succeeds only where the checked runtime and host artifacts can be assembled and verified; unsupported operating-system and architecture pairs fail closed.
- **Public npm remains bootstrap-required** — none of the thirteen package names exists, so a separately authorized interactive 2FA publication must create them before per-package npm trust can make the release workflow OIDC-ready; staged publishing cannot create a brand-new package. The bootstrap, repository visibility change, trust configuration for `clawdsh-publish.yml` and environment `npm`, branch restriction to `clawdsh`, and release itself remain external and unexecuted.
