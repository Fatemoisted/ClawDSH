# ADR-0006：正式可发布的开源形态——ClawDSH 为主角

[English](0006-open-source-posture.md) | 中文

- **状态**：已接受（2026-08-14）
- **日期**：2026-08-14
- **依赖**：ADR-0001（品牌/构建豁免）、ADR-0004（npm 发布）
- **分发条款由其取代**：ADR-0009（2026-08-15）

ADR-0009 取代决策 5、相关私有 registry 影响和公共 npm 备选项。本 ADR 中的源码、许可证、署名与贡献姿态仍然有效；把仓库设为 public 仍需用户另行授权。

## Context

阶段 4（「用户生态」）让 ClawDSH 成为有用户的项目。要让陌生人能采用它，仓库必须读起来是 **ClawDSH 的项目**——在 DeepSeek Harness（dsh）上重建 OpenClaw 个人助手功能集——而非「DeepSeek 的仓库里塞了几个私有插件」。今天有三个根文件仍反着说：`CONTRIBUTING.md` 保留上游的「we cannot accept external pull requests at the moment」；`LICENSE` 仅 `Copyright (c) 2026 DeepSeek`；根 `package.json` 有 `"name": "clawdsh"` 却无 `homepage`/`bugs`/`repository`。此外，若干自有文档已过时（`docs/specs/product-chain.md` 中的 ❌ 行）：读者顺着 `packages/openclaw/README.md`、`docs/matrix/parity.md`、`AGENTS.md` 或 `docs/specs/roadmap.md` 会被积极误导——不知道究竟交付了什么。

本 ADR 让仓库承诺正式可发布的开源形态，并记录该形态所需的精确上游处置与清理项。它管辖 **源码 + 许可证 + 贡献姿态**，不管辖 npm 分发面——那已由 ADR-0004 管辖。

## Decision

1. **开源形态是阶段 4 的目标。** ClawDSH 是仓库的主角；上游 `deepseek-ai/deepseek-harness`（git 远程 `upstream`）保持署名与跟踪。「可发布」意味着陌生人读 README、LICENSE、CONTRIBUTING 就能正确归属项目，且除既有 ADR-0001/ADR-0004 豁免与下述三条新增外，不重写任何上游文件。

2. **三条新增上游处置（豁免）。** 走向开源需要三处额外上游文件改动，均为新增式、可 rebase 重放：
   - `CONTRIBUTING.md` / `CONTRIBUTING.zh.md`：在上游正文上方新增 ClawDSH 品牌段，并把 CONTRIBUTING 纳入 ADR-0001 品牌段可改清单。上游正文（「we cannot accept external pull requests」）对一个现已开放贡献的项目是事实性错误；它作为品牌段下方的上游余文保留。
   - `LICENSE`：在保留的上游 `Copyright (c) 2026 DeepSeek` 之下追加 `Copyright (c) 2026 ClawDSH contributors`。MIT 承自上游；派生品保留双份声明。
   - 根 `package.json`：新增 `homepage` / `bugs` / `repository`，指向 `github.com/Fatemoisted/ClawDSH`（`@clawdsh/*` 各清单已按 ADR-0004 携带此字段）。

3. **过时文档清理是发布门禁。** 产品链路台账中的 ❌ 不一致——`packages/openclaw/README.md` roster（skills-hub/automation 仍「planning」、automation seam 误标）、`docs/matrix/parity.md` 联邦行、`AGENTS.md` 阶段标记、`docs/specs/roadmap.md` 阶段 3 标记——不可省略：它们会积极误导。须在首次公开发布前落地，连同 ⚠️ 对齐项（embeddings-ark e2e 断言在两份自有文档间互相矛盾）。

4. **批准自有内容面清单。** 对齐 ADR-0001 决策 3 与 CLAUDE.md 品牌段：把 `docs/upstream-proposal/` 补进物理隔离清单（该目录晚于该决策出现），并把 `.agents/notes/` 列为「仅追加」的自有笔记面（带日期戳、rebase 干净）。两者事实上已在使用；此处只是让清单成为权威。

5. **npm 注册表与开源解耦。** 本 ADR 不重开 ADR-0004 的私有注册表决策。`@clawdsh/*` 的 npm 面保持私有，直到发起者另行决定公开 npm；源码开放与注册表可达性相互正交。

## Consequences

- ✅ 陌生人能正确归属项目、且不会再被「不接受 PR」劝退；上游保持 rebase 干净（三处新增式编辑，与 ADR-0001/ADR-0004 同样重放）。
- ⚠️ `CONTRIBUTING`、`LICENSE`、根 `package.json` 变为 (c) 类上游编辑——每次上游同步都要重放，与 tsconfig 注册点相同。
- ⚠️ 仓库开源而 npm 注册表仍私有（ADR-0004）；这一分裂必须写清，以免姿态被误读为公开 npm 分发。
- ⚠️ 下方清理清单是一次性成本；落地后由 `doc-sync` + 翻译配对门禁持续约束文档诚实。

## Cleanup checklist (pre-publish)

| # | 目标文件 | 动作 | 原因 | 时限 |
|---|---|---|---|---|
| 1 | `packages/openclaw/README.md:40` | skills-hub「planning」→「implemented (phase 3 ✅)」 | roster 与矩阵 + 代码相矛盾 | 发布前必须完成 |
| 2 | `packages/openclaw/README.md:41` | automation「planning」+ seam「`ctx.schedule` / `ctx.jobs`」→「implemented (phase 3 ✅, disabled opt-in)」+「`ctx.agents` + `ctx.sessions`」 | roster 与矩阵 + 代码相矛盾；seam 点名了一个被否决的 seam | 发布前必须完成 |
| 3 | `packages/openclaw/README.md:39` | 对齐 embeddings-ark「e2e pending credentials」与 `roadmap.md`「real ARK e2e (tools/ark-e2e.ts)」 | 两份自有文档互相矛盾 | 发布前必须完成 |
| 4 | `docs/matrix/parity.md:46` | 联邦名称「to be named」→「`clawd-federation`」；状态 →「ADR-0005 evaluation-only, implementation deferred」 | ADR-0005 已命名；阶段 3 已收尾 | 发布前必须完成 |
| 5 | `AGENTS.md:18`（= `CLAUDE.md` 符号链接） | 「当前阶段：阶段 2」→「阶段 4」 | 阶段标记过时 | 发布前必须完成 |
| 6 | `docs/specs/roadmap.md:42` | 补阶段 3 完成标记 ✅（2026-08-14） | 章程无阶段 3 收尾标记 | 发布前必须完成 |
| 7 | `CONTRIBUTING.md` + `.zh.md` | 置顶 ClawDSH 贡献品牌段；扩展品牌段可改清单（决策 2） | 上游「不接受 PR」与开源相矛盾 | 发布前必须完成 |
| 8 | `LICENSE` | 追加 `Copyright (c) 2026 ClawDSH contributors`（保留上游 MIT，决策 2） | 派生品署名 | 发布前必须完成 |
| 9 | 根 `package.json` | 新增 `homepage` / `bugs` / `repository` → `Fatemoisted/ClawDSH`（决策 2） | 可发布包元数据 | 发布前必须完成 |
| 10 | `docs/specs/roadmap.md:36` | 补阶段 2 标题 ✅（与阶段 0/1 对齐） | 章程外观一致性 | 可延后 |
| 11 | `docs/adr/0001-project-foundation.md` 决策 3 | 把 `docs/upstream-proposal/` 补进物理隔离清单（决策 4） | 与 CLAUDE.md 品牌段对齐 | 可延后 |
| 12 | `AGENTS.md` 品牌段 | 把 `.agents/notes/`（仅追加自有笔记）补进自有内容清单（决策 4） | 批准事实存在的笔记面 | 可延后 |
| 13 | `docs/specs/` | 为 `embeddings` / `embeddings-ark` 补独立 feature spec（当前归在 `feature-memory` 下）；canonical channel behavior 继续由 `feature-channel-plane-bridge` 负责 | 不恢复直连 adapter 的逐 plugin spec 完整性 | 可延后 |

## Alternatives

- **上游 CONTRIBUTING / LICENSE / 元数据一概不动（否决）**：一个说「我们不接受 PR」、且版权只归 DeepSeek 的「可发布」项目，实际并不像 ClawDSH 那样可发布。
- **仅在 README 品牌段承载贡献指引（否决）**：GitHub 仍会先向贡献者展示过时的上游 CONTRIBUTING；这一错配正是要修的。
- **重新许可（否决）**：MIT 承自上游；对派生品重新许可需上游许可，且无阶段 4 目标受益。
- **在本 ADR 里把 npm 注册表翻为公开（否决）**：注册表可达性是分发决策，与源码开放正交；仍归 ADR-0004 管辖。
