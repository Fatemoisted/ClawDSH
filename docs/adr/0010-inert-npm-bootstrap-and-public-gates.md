# ADR-0010: Inert npm bootstrap and public-release gates

English | [中文](0010-inert-npm-bootstrap-and-public-gates.zh.md)

- **Status**: Accepted (2026-08-17); remote publication and repository visibility changes remain separately unauthorized
- **Date**: 2026-08-17
- **Refines**: ADR-0009 decision 4
- **Depends on**: ADR-0006, ADR-0009

## Context

ADR-0009 reserves `0.1.0-rc.1` for the first functional public candidate and requires package-level trusted publishing, but npm trusted publishers cannot be configured before each package identity exists. Publishing the functional candidate interactively would consume its immutable version outside the provenance-bearing workflow. Publishing normal package contents merely to create the names would expose executable code and dependency edges before the routine release authority exists.

The repository also needs a reviewable public-source posture before its visibility changes: contributors must see ClawDSH's actual acceptance policy, derivative copyright must retain both parties' notices, repository metadata must point to ClawDSH, and committed history introduced by the ClawDSH branch must receive a non-mutating secret check. None of those preparations authorizes making the repository public or writing to npm.

## Decision

### 1. Reserve the package identities with an inert `0.1.0-rc.0`

The one-time bootstrap uses version `0.1.0-rc.0` and the custom `bootstrap` dist-tag for exactly the thirteen names in `RELEASE_PACKAGES`, in its checked order: `@clawdsh/dsh-activity`, `@clawdsh/dsh-channel`, `@clawdsh/dsh-embeddings`, `@clawdsh/dsh-automation`, `@clawdsh/dsh-skills-hub`, `@clawdsh/dsh-soul`, `@clawdsh/dsh-channel-agent`, `@clawdsh/dsh-channel-openclaw`, `@clawdsh/dsh-embeddings-ark`, `@clawdsh/dsh-memory`, `@clawdsh/dsh-preset-messaging-safe`, `@clawdsh/dsh-bundle`, and `@clawdsh/cli`.

Each tarball contains exactly `package.json`, the repository `LICENSE`, and a package-specific warning `README.md`. Its manifest contains only identity, description, license, repository/homepage/bugs metadata, and a `publishConfig` fixed to public access, the public npm registry, and `bootstrap`. It contains no dependencies, `bin`, exports, `main`, scripts, files allowlist, executable payload, or code. The README tells users not to install the bootstrap and identifies `0.1.0-rc.1` as the first functional candidate.

### 2. Make the bootstrap byte-reproducible and closed

The bootstrap writer constructs its npm tar format directly under pinned Node `24.19.0`, with fixed path order, modes, uid/gid, timestamp, gzip level, and gzip platform byte. Generation requires a new output directory. `bootstrap-index.json` lists exactly thirteen canonical filenames in the release allowlist order and records each archive's byte length and SHA-512 integrity. Verification reopens every archive, compares all three files and the complete compressed archive byte-for-byte with the generated contract, rejects any additional directory entry or manifest field, and requires the checked index to equal the archives.

The read-only `clawdsh-bootstrap` workflow runs the history audit and bootstrap tests, generates the same closed set, verifies it, and uploads it as a short-lived artifact. It has only `contents: read`, no npm credential, no OIDC write permission, and no publication step.

### 3. Keep the exceptional write manual, single-step, and resumable

Bootstrap publication remains outside GitHub Actions. After separate approval of the repository visibility change, exact archive set, npm scope, and remote writes, a maintainer uses an interactive 2FA-protected npm session. The checked inspector contacts only `https://registry.npmjs.org/` without credentials. For every existing `0.1.0-rc.0`, its remote `dist.integrity` must match `bootstrap-index.json`, the `bootstrap` tag must point to that version, and `latest` must be absent. A mismatch stops the procedure.

When identities remain, the inspector prints one explicit `npm publish <tarball> --ignore-scripts --access public --tag bootstrap --registry https://registry.npmjs.org/` command but never executes it. The maintainer reviews and runs that single command, then reruns the inspector. Matching packages are skipped, so an interrupted bootstrap resumes from verified remote state without republishing immutable versions. Batch loops, long-lived npm write tokens, moving `latest`, and automatic repair are prohibited.

### 4. Preserve `0.1.0-rc.1` for `next` and OIDC

The functional release remains `0.1.0-rc.1`. `clawdsh-publish.yml` still defaults to a complete read-only dry run. Its public write job alone receives `id-token: write`, publishes verified functional tarballs with provenance, and accepts only the `next` tag. It never creates or moves `latest` and never republishes bootstrap archives.

A requested public write regenerates the inert bootstrap contract and obtains read-only registry evidence. After the protected npm environment grants the publish job authority, that job checks the live registry state again before readiness and publication. Release readiness requires the checked evidence to match the closed bootstrap index, prove all thirteen remote integrities and `bootstrap` tags, and prove the absence of `latest`, in addition to the scope, trusted-publisher, public-repository, compatibility, branch, smoke, and per-run human confirmations from ADR-0009.

### 5. Complete the additive public-source governance layer

The ClawDSH prelude in both CONTRIBUTING files welcomes issues and pull requests, links the plugin/spec/matrix gates, and explains that the retained upstream no-PR text governs DeepSeek Harness rather than ClawDSH. The MIT license retains DeepSeek's notice and adds `Copyright (c) 2026 ClawDSH contributors`. Root package metadata names the ClawDSH repository, homepage, and issue tracker. These remain additive, rebase-replayable upstream-file dispositions recorded in the root ClawDSH AGENTS block.

The pre-public history audit resolves the merge base between an explicit upstream mirror ref and the release head, then scans every blob introduced by the complete ClawDSH commit range, including blobs added and deleted before the current tree. It reports only the rule, path, and object id, never the matched value. It uses high-confidence credential forms and sensitive filenames, is not a proof that no secret exists, and never rewrites history. A finding stops publication for an explicit remediation decision.

## Consequences

- The exceptional interactive publish creates inert package identities without consuming or weakening the functional candidate.
- A partial bootstrap is safely resumable only from registry integrities that match the reviewed artifact; unexpected immutable state fails closed.
- Neither `bootstrap` nor `next` establishes a stable `latest` channel. A future stable release requires a separate version and decision.
- Public-source governance and secret-history review become release gates while repository visibility and registry writes remain explicit user actions.
- The bootstrap tools and runbook are long-lived audit material, but successful bootstrap publication is a one-time operation.

## Alternatives

- **Publish `0.1.0-rc.1` interactively**: rejected because the functional version would no longer be publishable by the provenance-bearing OIDC workflow.
- **Bootstrap with the normal package payloads**: rejected because package-name creation needs no executable code, dependency graph, or install authority.
- **Use `latest` or `next` for the bootstrap**: rejected because inert packages must not appear as either the stable channel or the functional candidate channel.
- **Automatically publish all thirteen packages**: rejected because the exceptional registry write needs per-step human control and integrity verification after every immutable publication.
- **Trust package existence without comparing integrity**: rejected because a partial or conflicting prior bootstrap must never be treated as safe merely because the version number exists.
- **Automatically rewrite Git history after a secret finding**: rejected because remediation can invalidate collaborator refs and signed history; the audit is read-only and stops for an explicit decision.
