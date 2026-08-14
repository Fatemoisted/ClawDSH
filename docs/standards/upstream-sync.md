# Upstream sync specification (upstream-sync)

English | [中文](upstream-sync.zh.md)

## Remote and branch layout

```
upstream → https://github.com/deepseek-ai/deepseek-harness.git   （官方，只拉不推）
origin   → https://github.com/Fatemoisted/ClawDSH.git            （私有，只推不拉）
master   → 上游镜像：只允许 fast-forward，禁止直接提交
clawdsh  → 我们的开发分支（已推送并跟踪 origin/clawdsh）：全部自有改动提交在这里，定期 rebase
```

> This project **is not a GitHub Fork** (the sponsor requires it to be settable as Private): it was directly cloned and pushed to a self-hosted private repo (done 2026-08-14). GitHub credentials live in the macOS keychain (`git credential-osxkeychain`), so routine `git push`/`git fetch origin` needs no token; to remove credentials run `git credential-osxkeychain erase` (enter host=github.com, then press return twice). Note: a GitHub personal access token must include the `workflow` scope, otherwise pushing a branch that contains `.github/workflows/` is rejected.

## Baseline pinning

| Item | Value |
|---|---|
| Upstream baseline commit | `47f943859b` (at clone on 2026-08-14) |
| Upstream version | v0.1.0-rc.5 (developer preview, **explicitly with breaking changes**) |
| Engine requirements | Node ^22.19 or ≥24; pnpm 11.7.0 (corepack / `npm i -g pnpm@11.7.0`) |

dsh is in developer preview and the upstream changes frequently: **the baseline only moves forward, never jumps** (update the table above on every sync).

## Sync process (tools/sync-upstream.sh)

1. `git fetch upstream`;
2. Check whether the upstream announced breaking changes (CHANGELOG / release notes / docs migration notes); if so, update the affected owned plugins first;
3. `git checkout master && git merge --ff-only upstream/master`;
4. `git checkout clawdsh && git rebase master` — on conflict, resolve by priority:
   - `README.md` / `AGENTS.md` (including the CLAUDE.md symlink) / root `package.json`: **take the upstream version, then re-pin the brand section at the top** (the brand section is delimited by the `<!-- ════ ClawDSH` marker);
   - `tsdown.config.ts`: after taking the upstream version, re-add the `packages/openclaw/*` skeleton exclusion (marked with a ClawDSH comment, see ADR-0001 decision 4);
   - `tsconfig.base.json` / `tsconfig.host.json`: after taking the upstream version, re-append the `@clawdsh/*` paths and references entries (append only, do not change existing entries);
   - `packages/openclaw/`, `docs/{adr,specs,matrix,standards,journal}/`, `tools/`: the upstream does not touch these directories, so in theory zero conflicts; if the upstream happens to add a same-named file, merge by hand and record it in `docs/journal/`;
5. Full verification: `pnpm install && pnpm typecheck`, plus the profile smoke test (from phase 2 onward);
6. Update the baseline table in this file + a `docs/journal/` entry.

## Red lines

- Never `push` to `upstream`;
- Never modify upstream file content (except the brand section, see above);
- For upstream breaking changes, prefer to postpone the sync (pin the old baseline) over rebasing with a known-broken state.
