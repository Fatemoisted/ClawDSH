# 文档清点 — dsh vs ClawDSH

[English](doc-inventory.md) | 中文

- **状态**：阶段 4 入口交付物（2026-08-14）
- **目的**：按归属清点仓库每个文件，让发布计划（ADR-0006）能精确说出：哪些上游处置需要 ADR 豁免、哪些文件本来就可自由重写。
- **方法**：三类归属——(a) 上游只读（细分为「品牌段可改」vs「完全不可碰」），(b) ClawDSH 自有，(c) 依 ADR 豁免嵌入上游文件的 ClawDSH 内容。其中 (c) 的依据是 ADR-0001 决策 4 与 ADR-0004。

## (a) 上游只读

「上游」指 `deepseek-ai/deepseek-harness`（git 远程 `upstream`）。只读，仅允许两类改动：品牌段置顶、以及 ADR 背书的新增式元数据/构建改动。

### (a1) 品牌段可改（仅一处置顶品牌段）

| 文件 | 品牌段 | 允许的改动 |
|---|---|---|
| `README.md` | 第 1–9 行，以 `<!-- ⬇ 以下为上游 README 原文 -->` 为界 | 仅替换品牌段 |
| `README.zh.md` | 第 1–9 行，同一分隔符 | 仅替换品牌段 |
| `AGENTS.md`（=`CLAUDE.md` 符号链接） | 第 1–22 行，以 `<!-- ⬇ 以下为上游原文 -->` 为界 | 仅替换品牌段 |

仅这三个文件可改品牌段。`packages/AGENTS.md` 与 `examples/AGENTS.md`（均为 `CLAUDE.md` 符号链接）**未**置顶品牌段——它们保持上游原样（见 a2）。

### (a2) 完全不可碰（无品牌段、不可直接改）

| 位置 | 备注 |
|---|---|
| `vendor/` | vendored Cordis 源码；清单 + 同步流程见 `vendor/README.md` |
| `packages/*`（除 `packages/openclaw/`） | 全部 `@deepseek-ai/dsh-*` 包 |
| `apps/`、`website/`（+ 其 `docs/`） | 上游应用与站点 |
| `native/`、`python/`、`examples/`、`assets/`、`patches/` | 上游运行时、SDK、示例、资源、补丁目录 |
| `docs/` 上游页 | `architecture`、`development`、`glossary`、`capability-seams`、`cordis-primer`、`cordis-tutorial`、`cordis-api`、`config-catalog`、`testing`、`defensive-patterns`、`event-producer-consumer`、`persistence-catalog`、`tool-catalog`、`tool-execution-pipeline`、`agent-lifecycle`、`api-gateway`、`rescope`、`module-graph`、`graph-atlas`、`web-styling`、`postmortem/`、`subsystems/`、`user/`、`cookbook/`、`i18n/`、`AGENTS.md` |
| `CONTRIBUTING.md`、`CONTRIBUTING.zh.md` | 上游贡献立场（见 ADR-0006） |
| `LICENSE` | 上游 MIT，`Copyright (c) 2026 DeepSeek`（见 ADR-0006） |
| `THIRD_PARTY_NOTICES.md`、`BENCHMARK.md` | 上游声明/基准 |
| `packages/AGENTS.md`、`examples/AGENTS.md` | 上游包/示例规则（未置顶品牌的 `CLAUDE.md` 符号链接） |
| `scripts/` | 上游门禁/生成器（含一处新增分支，见 c） |
| `.github/workflows/*`（除 `clawdsh-*`） | 上游 CI |
| `.agents/skills/`、`.agents/notes/` | 上游技能 + 笔记（ClawDSH 追加自有笔记，见 c） |
| 根配置 | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig*.json`、`tsdown.config.ts`、`vitest*.ts`、`knip.json`、`lefthook.yml`、`.editorconfig`、`.gitattributes`、`.gitignore`、`.gitlab-ci.yml`、`.jscpd.json`、`.oxlintrc*.json`、`.rgignore`、`pytest.ini`——凡适用者各带一处 (c) 所列的新增式编辑 |

## (b) ClawDSH 自有文件

| 位置 | 内容 |
|---|---|
| `packages/openclaw/` | 唯一可重写的代码域——`preset-openclaw/`、`channel-core/`、`channel-telegram/`、`channel-feishu/`、`channel-wechat/`（决策记录）、`soul/`、`memory/`、`embeddings/`、`embeddings-ark/`、`skills-hub/`、`automation/`、`_template/` |
| `docs/adr/` | 0001–0005（项目基石、渠道 seam、embedding seam、npm 发布、clawd 联邦） |
| `docs/specs/` | `roadmap.md` + `feature-soul` / `feature-channel-core` / `feature-memory` / `feature-skills-hub` / `feature-automation` |
| `docs/matrix/parity.md` | feature 对齐的单一事实源 |
| `docs/standards/` | `naming`、`plugin-contract`、`pr-policy`、`upstream-sync` |
| `docs/journal/2026-08-14.md` | 详尽开发日志 |
| `docs/upstream-proposal/ctx-channels.md` | 向上游提交的 `ctx.channels` seam 提案 |
| `tools/` | `ark-e2e.ts`、`link-openclaw.sh`、`sync-upstream.sh` |
| `.github/workflows/clawdsh-publish.yml`、`clawdsh-smoke.yml` | ClawDSH CI |

## (c) 嵌入上游文件的 ClawDSH 内容

| 文件 | 嵌入内容 | ADR 依据 |
|---|---|---|
| `README.md`、`README.zh.md` | 品牌段（第 1–9 行） | ADR-0001 决策 4 |
| `AGENTS.md` | 品牌段（第 1–22 行） | ADR-0001 决策 4 |
| `package.json` | `"name": "clawdsh"` | ADR-0001 决策 4 |
| `tsdown.config.ts` | workspace `exclude` 列表新增 `packages/openclaw/**` | ADR-0001 决策 4 |
| `tsconfig.base.json` | 9 条 `@clawdsh/dsh-*` `paths`（仅新增） | ADR-0001 决策 4 |
| `tsconfig.host.json` | 9 条 `@clawdsh/dsh-*` `references`（仅新增） | ADR-0001 决策 4 |
| `scripts/check-workspace-constraints.ts` | `@clawdsh/` 发布形态分支 + 非包目录跳过 | ADR-0004 |
| `.agents/notes/` | 11 条 ClawDSH 笔记（33 文件），日期 2026-08-14，仅追加 | 笔记机制（无 ADR——见灰度） |

## 边界灰度

- `.agents/notes/` 是 ClawDSH **无 ADR** 就往上游树写自有内容的唯一一处。它只追加（文件名带日期戳、上游不会新增 `2026-08-14-*`），故 rebase 干净，但 CLAUDE.md 的「自有代码只允许出现在…」清单未枚举它。需决定：补进清单，还是补一条一行 ADR 说明。
- `docs/upstream-proposal/` 是 ClawDSH 自有、且已列入 CLAUDE.md 品牌段，但 ADR-0001 决策 3（物理隔离清单）漏掉它，因该目录晚于该决策出现。需对齐两份清单。
- `docs/postmortem/` 是上游目录，但适用与笔记相同的追加机制；ClawDSH 以后可在此追加自有 postmortem。
- `tools/` 是自有代码（非文档），但它是 ClawDSH 脚本与 e2e 驱动的指定归宿。

## 面向发布的缺口（移交 ADR-0006）

- `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` 仍保留上游「we cannot accept external pull requests」立场——与可发布开源项目相矛盾。它不在品牌段可改清单里，故需 ADR 豁免（把品牌段置顶扩展到 CONTRIBUTING，或在 README 品牌段承载 ClawDSH 贡献指引）。
- `LICENSE` 是上游 MIT（`Copyright (c) 2026 DeepSeek`）；派生 fork 必须保留上游声明，并可追加一行 ClawDSH 版权。
- `package.json` 缺指向 `Fatemoisted/ClawDSH` 的 `homepage`/`bugs`/`repository` 字段；可发布包需要这些字段。这是 (c) 类编辑、需 ADR 说明。
