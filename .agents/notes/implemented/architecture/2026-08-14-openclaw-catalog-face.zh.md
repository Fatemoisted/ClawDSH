# Agent Note: OpenClaw 包在 host 程序外自建类型检查 face

Status: implemented

[English](2026-08-14-openclaw-catalog-face.md) | 中文

## 问题

rebase 后的远程树把 9 个 `packages/openclaw/*` 包注册进了 `tsconfig.host.json` 的 `references`。cordis-catalog 门禁对 host face 是 **fail-closed 双向**的（scripts/gen-cordis-catalog.ts + typert 投影）：每个声明的 Context key 与事件必须在硬编码的 `SERVICE_PAGE`/`EVENT_SCOPE_PAGE` 分类表里有归属，或在 walk 豁免表里具名——已渲染却豁免、已豁免却未声明，同样违规。投影扫描 openclaw references 时，把扩展 seam 类型（`ChannelAdapter`、`EmbeddingVector`）与事件（`channel/inbound`、`channel/outbound`）判定为不可分类，产生 4 条 type-link 违规与 partition 问题。分类表在只读上游脚本里，openclaw 代码又不许进上游目录，走分类表路线行不通。

## 决策

openclaw 包**永久不进 `tsconfig.host.json`**；seam 经 `scripts/gen-cordis-catalog.ts` 的 4 条 walk 豁免存活（唯一获准的上游文件改动，发起人选定"摘除 + 4 行豁免"方案）：`SERVICE_WALK_EXEMPTIONS` 增加 `channels` 与 `embeddings`；`EVENT_WALK_EXEMPTIONS` 增加 `channel/inbound` 与 `channel/outbound`。三个 catalog 面除这 4 行外与上游逐字节一致。

类型检查拆成三块：

- **构建**：`packages/openclaw/tsconfig.json`——复合聚合（`files: []` + 9 个 references）发射 `lib/types`。
- **测试**：`packages/openclaw/tsconfig.check.json`——纯非复合检查程序，通配 `*/src/**` 与 `*/tests/**`。没有 references，导入走 `paths` 解析：9 个 vendor paths 重定向到构建产物 `lib/types`（vendor src 在基座 strict 旗标下编译不过——vendor 包按自身宽松配置编译，host 程序经 references 只看到声明输出），3 个 base paths 缺条目的测试专用依赖（`dsh-agent-loop`、`dsh-system-prompt`、`dsh-tools`）补显式 paths 指向其 src。
- **host 侧**：`tsconfig.host.json` exclude `packages/openclaw/*/tests/**`（否则测试经 paths 导入 openclaw src 会以"未列文件"重新进入 host 程序 → TS6307）。

## 考虑过的替代方案

- **把 seam 类型登记进上游 catalog 分类表**——否决：分类表在只读上游脚本，openclaw 代码也不许进上游目录；上游 `ctx.channels` PR（发起人 2026-08-14 撤回）本来是载体。
- **保留 host references 并全量豁免**——否决：门禁 fail-closed 双向，rendered-but-exempt 方向照样报，投影也仍会扫描不可分类的 openclaw 类型。
- **把 openclaw 测试加进 host 程序的 `include`**（文件在列表内 → 无 TS6307）——否决：测试会把整个上游导入图拉进 host face，扩大 host 程序与 catalog 面；独立检查程序把该风险隔离在 openclaw 聚合内部。
- **纯检查程序直连 vendor src**——先试过，实测失败：`vendor/cosmokit` 与 `vendor/schemastery` 在继承的 strict 旗标下报错（TS2345/TS4114/TS2412/TS2322），故改为 `lib/types` 重定向。

## 影响

- openclaw 不再是上游程序的一部分：自有聚合（`tsconfig.json`）+ 自有检查程序（`tsconfig.check.json`）；`tools/link-openclaw.sh` 与 `.github/workflows/clawdsh-smoke.yml` 都跑两者。
- 今后 openclaw 每新增 Context key 或事件，都要在 walk 豁免表登记（当前 4 条）或等上游 seam PR；漏登记会让 `verify-cordis-catalog` 显式失败，不会静默。
- 检查程序要求先跑 openclaw 聚合（或 host 构建）——它读构建好的 `vendor/*/lib/types`。
- `packages/openclaw/README.md` 接入流程第 4 步改述聚合注册，替代旧的 host-reference 流程。
