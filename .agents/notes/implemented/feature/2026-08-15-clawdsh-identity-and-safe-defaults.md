# Agent Note: ClawDSH identity and safe clean-install defaults

Status: implemented

English | [中文](2026-08-15-clawdsh-identity-and-safe-defaults.zh.md)

## Problem

The local GUI composition was installed as profile and preset id `openclaw`, displayed as an OpenClaw shape, and refreshed through `tools/link-openclaw.sh`. Those names made an upstream feature source look like the ClawDSH product identity. The profile also mounted Feishu by default, so its credential validation prevented a clean home without channel credentials from starting the Web Host.

Renaming installed assets has a separate compatibility risk: existing Sessions can persist the old preset id, and user-owned `openclaw` profile or preset directories may contain local changes. A product rename must not silently alias, adopt, rewrite, move, or delete those assets.

## Decision

The installed profile id, agent preset id, and default preset are `clawdsh`; the preset label is `ClawDSH 模式`; and the local development refresh entry point is `tools/link-clawdsh.sh`. The physical source directory remains `packages/openclaw/preset-openclaw/` because repository checks recognize that path. The directory name is internal and does not define product copy, an installed id, or a compatibility alias. OpenClaw remains the name of the upstream behavior source where provenance or literal upstream paths require it.

The profile keeps `channel-core` mounted but marks Feishu, Telegram, and Automation Loader entries disabled. A clean home can therefore start the Web application without Feishu, Telegram, Ark, or automation credentials and without creating external channel or scheduled-run side effects. Enabling a credentialed adapter remains an explicit configuration action; its existing fail-loud credential validation applies when it is mounted.

`tools/link-clawdsh.sh` checks the legacy `$DSH_HOME/profiles/openclaw/` and `$DSH_HOME/.agent-presets/openclaw/` paths before installing the new assets. It prints migration guidance when either exists and leaves both untouched. ClawDSH does not install an `openclaw` alias, and the script never automatically deletes, moves, rewrites, or adopts a legacy directory. Users retain an old preset while any saved Session still references its id.

The ClawDSH preset remains a managed copy in the dsh user preset root; it is not system-trusted or undeletable, and stock Harness controls can remove it. The [product-shell proposal](../../proposed/architecture/2026-08-15-clawdsh-product-shell.md) excludes a deletion entry from the ClawDSH product UI without changing that trust model. This increment does not ship the product shell, a `clawdsh` executable, `clawdsh doctor`, or a managed-install manifest. The development refresh script is the available repair path; the public distribution increment owns manifest-based installation and doctor repair.

## Alternatives considered

**Keep `openclaw` as a supported alias.** Rejected: two durable ids would make the product identity ambiguous and require every installer, Session selector, diagnostic, and future settings surface to define precedence indefinitely.

**Automatically rename or delete legacy directories.** Rejected: a legacy preset can be required to resume a saved Session, and either directory may be user-owned. Warning with exact paths preserves recoverability and leaves cleanup under user control.

**Rename `preset-openclaw` with the installed ids.** Rejected for this increment: repository checks currently recognize that physical assembly path. Keeping one explicitly internal source path avoids widening this identity change into root check or upstream-owned configuration changes.

**Enable channel adapters whenever matching environment variables exist.** Rejected: clean-install behavior would depend on ambient credentials and could start external listeners unexpectedly. Disabled defaults make every external side effect explicit.

## Consequences

- New development installs use one product identity across command, profile, preset, default selection, and visible label.
- Clean-home GUI startup is independent of optional channel and automation credentials; those capabilities remain opt-in at the Loader layer in this increment.
- The ClawDSH smoke workflow runs a keyless real-profile browser lane that starts the built Host from an empty dsh home and snapshots the visible `ClawDSH 模式` entry together with the selected `clawdsh` preset id. Its `gui-tests/` sources use a dedicated TypeScript program and stay outside the root Host aggregate.
- Existing `openclaw` assets receive a warning but no compatibility promise or automatic lifecycle management.
- The ordinary dsh user-preset trust model remains visible: Harness-owned controls can delete the preset, the ClawDSH product UI does not gain a deletion entry, and rerunning `tools/link-clawdsh.sh` repairs a development install.
- A formal `clawdsh doctor` command and managed-install manifest are absent until the public distribution increment supplies their ownership and overwrite policy.
