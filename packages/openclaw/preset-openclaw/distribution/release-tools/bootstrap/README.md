# One-time npm bootstrap runbook

English | [中文](README.zh.md)

This runbook creates the thirteen public `@clawdsh` package identities without consuming the functional `0.1.0-rc.1` candidate. It does not authorize a repository visibility change or an npm write.

## Safety properties

- Bootstrap version: `0.1.0-rc.0`; dist-tag: `bootstrap`.
- Generate, verify, and publish from Node `24.19.0`, the version pinned by both release workflows.
- Each archive contains only `package.json`, `LICENSE`, and a warning `README.md`. It has no code, dependencies, executable, exports, entry point, or lifecycle script.
- `bootstrap-index.json` closes the exact allowlist and records every archive's size and SHA-512 integrity.
- The read-only registry check refuses a mismatched immutable version, an incorrect `bootstrap` tag, or any `latest` tag. It prints one next command but never publishes.
- The functional `0.1.0-rc.1` release remains reserved for the OIDC workflow and the `next` tag.

## Prepare and review

From the repository root, create a new output directory and verify it:

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/secret-history-audit.mjs --base upstream/master --head HEAD
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-pack.mjs --repository-root . --output /absolute/new/clawdsh-bootstrap
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-verify.mjs /absolute/new/clawdsh-bootstrap
```

The read-only `clawdsh-bootstrap` workflow produces the same reviewed artifact. Compare its `bootstrap-index.json` before using a downloaded copy. Keep the repository at that reviewed commit through bootstrap completion and the `0.1.0-rc.1` release: changing the license or bootstrap contract changes immutable archive bytes and must fail the integrity check.

## Publish only after separate authorization

The repository must already be public, the exact artifact set must have been approved, the npm account must own `@clawdsh`, and interactive two-factor authentication must be enabled. Do not add a long-lived npm write token to the repository or workflow.

Run the registry inspector:

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-publication.mjs --directory /absolute/new/clawdsh-bootstrap --repository-root .
```

If a package is absent, the inspector prints exactly one `npm publish` command with the public registry, public access, and `--tag bootstrap`. Review and execute only that command in the separately authorized interactive npm session, then rerun the inspector. Never batch all thirteen commands. A previously published package is skipped only when its remote integrity matches `bootstrap-index.json`, its `bootstrap` tag points to `0.1.0-rc.0`, and `latest` is absent.

After all thirteen packages verify, record fresh read-only evidence:

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-publication.mjs --directory /absolute/new/clawdsh-bootstrap --repository-root . --require-complete --attestation /absolute/new/bootstrap-attestation.json
```

Then configure and verify the thirteen trusted-publisher records for repository `Fatemoisted/ClawDSH`, workflow `clawdsh-publish.yml`, and environment `npm`; restrict that environment to the canonical `clawdsh` branch. Run `clawdsh-publish` with `publish=false` first. A later `publish=true` invocation still requires every explicit readiness confirmation, rechecks the live bootstrap state after the protected environment grants authority, and republishes none of the bootstrap archives.

If any integrity or tag check fails, stop. Do not overwrite an immutable npm version, move `latest`, regenerate around the mismatch, or rewrite Git history automatically.
