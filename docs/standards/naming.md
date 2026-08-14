# Naming and commit conventions (naming)

English | [中文](naming.zh.md)

## Packages and code

| Subject | Convention | Example |
|---|---|---|
| Project name | ClawDSH (CLI prefix candidate `clawdsh` / alongside dsh) | — |
| Own package name | `@clawdsh/dsh-<kebab-case>`, isomorphic to upstream `@deepseek-ai/dsh-*` | `@clawdsh/dsh-soul` |
| Channel package | `channel-<platform>` | `channel-telegram` |
| In-package layout | Follow upstream package conventions (`src/`, `lib/` build output, README always carries the four-section template) | — |
| Service key | `ctx.<camelCase>`; a new seam must be named by ADR | `ctx.channels` |
| Event name | Follow dsh conventions (domain/verb, e.g. `channel/inbound`) | See ADR-0002 for detail |

## Documentation

| Subject | Convention | Example |
|---|---|---|
| ADR | `docs/adr/NNNN-<kebab>.md`, four-digit numbering incrementing, with status/date/context/decision/consequences/alternatives | `0002-channel-seam.md` |
| Feature spec | `docs/specs/feature-<kebab>.md`, five-section form (goals / non-goals / seam / config surface / acceptance criteria) | `feature-soul.md` |
| Development journal | `docs/journal/YYYY-MM-DD.md` (multiple sessions on the same day append to the same file) | `2026-08-14.md` |

## Git

- **Commit**: Conventional Commits, scope is the package name: `feat(soul): initial persona provider`, `docs(adr): add channel seam decision`, `fix(channel-core): inbound routing retry`; the trailer signing convention keeps the upstream `Co-Authored-By` form (AI-assisted commits must note it).
- **Branch**: `master` = upstream mirror (fast-forward only); `clawdsh` = development trunk; feature branches `feat/<kebab>` branch from `clawdsh` and are deleted after merging back into `clawdsh`.
- **Commits from upstream sync** (rebasing upstream) are not mixed into feature commits; the rebase keeps a linear history.
