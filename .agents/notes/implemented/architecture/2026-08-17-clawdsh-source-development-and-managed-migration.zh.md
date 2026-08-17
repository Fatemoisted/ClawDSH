# Agent Note: ClawDSH 源码开发隔离与托管迁移

Status: implemented

[English](2026-08-17-clawdsh-source-development-and-managed-migration.md) | 中文

[公共发行决策](../feature/2026-08-15-clawdsh-public-distribution.md)拥有受管产品 profile 与 `.clawdsh.json`。本 Note 拥有独立源码开发 home，以及从已识别历史 source-linked 布局到公共受管 profile 的一次性转换。

## 问题

Source linker 会安装进公共产品使用的同一个 `$DSH_HOME`，把完整产品 patch 复制进用户也视为 profile override 的路径，每次刷新都复制两个 presets，而且没有 source-install ownership marker。重复运行因此可能覆盖用户 patch 或 preset，后续公共安装器也无法区分干净 source 布局与用户创建或修改的同名目录。

公共安装不能通过广泛接管路径来消除这种歧义。Settings、凭据、Sessions、Memory、Skills、Activity 与 OpenClaw state 包含用户数据或密钥；即使历史 source-owned profile 与 presets 也可能含有本地修改。迁移需要闭合识别规则、仅属主可访问的备份，以及一项绝不会让管理 marker 声称部分转换已完成的 transaction。

## 决策

源码开发使用 `CLAWDSH_DEV_HOME`，默认 `~/.clawdsh-dev`，且绝不 fallback 到公共 `DSH_HOME`。`tools/run-clawdsh-dev.sh` 会从调用者目录解析相对开发 home，通过绝对路径调用 source installer 刷新它，再导出为 `DSH_HOME`、为源码路径解析固定仓库 `tsconfig.json`，并在不改变调用者工作目录的情况下启动源码 CLI。因此 workspace 与 `.env` 发现继续由调用者控制，不会隐式加载 checkout 根目录的 `.env`。所选开发 home 中存在公共 `.clawdsh.json` marker 会报错，因此公共 home 与 source-managed home 可以并存，但不能共享所有权。

开发 profile 依次组合 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与私有 `@clawdsh/dsh-dev-bundle`。私有 bundle 携带产品组合与闭合源码依赖集合。`profiles/clawdsh/cordis.patch.yml` 只在首次安装 profile 时从空用户层模板创建；后续 source refresh 绝不替换它。Presets 与已记录 symlink 继续归开发安装器所有，但已修改的受管资产会阻断刷新，除非先运行 `tools/link-clawdsh.sh --backup-modified`，把开发 profile、presets 与 link 证据复制到 `.clawdsh-dev-backups/`。仅属主可访问的管理锁会覆盖检查、可选备份、candidate publication 与 marker replacement，使两次刷新不能交错。

公共 CLI 暴露独立迁移接口：

```text
clawdsh migrate source
clawdsh migrate source --apply
clawdsh migrate source --apply --backup-modified
```

第一种形式是只读检查。`--backup-modified` 只能与 `--apply` 同时使用；不存在接受未知布局的强制选项。

## 磁盘格式

| 格式 | 用途 | Schema v1 必需字段 |
|---|---|---|
| `$CLAWDSH_DEV_HOME/.clawdsh-dev.json` | 开发所有权与刷新证据 | `schemaVersion`、`profileId`、`repositoryRoot`、`profile.packageIntegrity`、`bundle.name`、`bundle.patchIntegrity`、闭合 `links` 与 `presets` |
| `$DSH_HOME/.clawdsh-backups/source-<timestamp>-<digest>/source-backup.json` | 公共 source-to-managed migration 的备份证据 | `schemaVersion`、`profileId`、`createdAt`、`evidenceIntegrity`、`modified`，以及包含 `path`、`target`、`resolvedTarget` 与 `packageName` 的 `links[]` entry |

开发 marker 的 link map 有 12 个精确 home-relative entry：11 个历史 feature／runtime link，加上 `@clawdsh/dsh-dev-bundle`。每个 target 都解析到 marker 中的同一个 repository root。Marker 还会记录两个 preset digest 与私有 bundle patch digest，但有意不记录任何 Settings、凭据、Session、Memory、Skill、Activity 或 OpenClaw path。

每次应用公共迁移都会以 `0700` 模式创建备份目录，其中包含历史 profile 以及 `clawdsh` 和 `clawdsh-messaging-safe` preset 的完整副本。Source-backup manifest 会保留原始与解析后的 symlink target 作为恢复证据；这些绝对路径可能暴露 checkout 位置，因此备份保持仅属主可访问。它不包含复制的产品数据或密钥文件。

## 识别与 transaction

只有以下事实全部成立，历史 source installation 才会被识别：

- 两层 `clawdsh` profile manifest 具有已知 package identity；
- profile patch 与两个 preset tree 匹配已知 digest，或可分类为该完整布局的修改；
- 全部 11 个历史 package／runtime entry 都是具有预期 package name 与发行身份的 symlink；
- 所有已解析 link 都属于同一个 ClawDSH checkout；
- 完整已知 profile、preset 与 link 集合存在，且没有 public 或 development marker。

Source-owned profile manifest 字节、patch、preset tree 或额外 profile entry 不同时，已知布局会成为 `modified`。干净 apply 可使用 `--apply`；modified apply 必须使用 `--apply --backup-modified`。缺失资产、不同 package identity、不安全 filesystem type、混合 checkout、未知 manifest 或未知 marker 都会让布局成为 unknown，并永久不允许自动接管。

每次 apply（包括干净迁移）都会在修改受管目标前写完仅属主可访问的完整备份。准备精确公共依赖树后，安装器会根据检查证据重新校验完整 profile tree、原始与解析后的 symlink target，以及两个 preset digest；准备期间出现的编辑会中止迁移，而不会覆盖较新的字节。随后一项 marker-last 公共安装 transaction 会替换 profile 与两个 presets，只移除 11 个已识别 source symlink，安装已准备的依赖树，并最后发布 `.clawdsh.json`。`profiles/node_modules/@clawdsh/` 下的其他 entry 不在 removal allowlist 中，会保持不变。Commit 前失败会恢复此前 target，并且不会遗留声称迁移完成的公共 marker。

Migration inspection 与 apply 绝不打开、复制、移动或改写 `settings.yaml`、`.credentials.yaml`、Sessions、Memory、Skills、Activity 或 OpenClaw 配置与 state。普通 `clawdsh init` 发现已知历史 footprint 时会报告精确的 clean 或 modified 迁移命令；未知 footprint 会报告原因并拒绝接管。

## 验证

Development-install test 固定了独立默认 home、调用者目录保留、显式源码路径配置、public-marker 拒绝、闭合 link 与 marker 校验、首次安装创建空 patch、重复刷新逐字节保留、修改 preset 后拒绝、显式备份、路径约束、并发刷新锁与回滚。公共 CLI test 固定了 dry-run 零写入、known-clean 与 known-modified 分类、未知布局拒绝、`--apply`／`--backup-modified` 关系、仅属主可访问的完整备份、精确 11-link 移除、无关 link 与用户数据保留、管理锁、commit 前 drift 拒绝、marker-last commit 与失败回滚。

Distribution test 通过真实受管 installer candidate 运行迁移，而不是模拟文件复制。测试会验证最终 profile、presets、依赖树与 `.clawdsh.json` 通过和干净公共安装相同的 `doctor` 检查。

## 考虑过的替代方案

**源码开发使用公共 `$DSH_HOME`。** 否决，因为源码 symlink 与公共不可变依赖具有不同 owner 和升级规则；同一个 marker 无法安全描述两者。

**把产品组合保留在 profile user patch。** 否决，因为刷新时只能在过时产品 wiring 与覆盖用户修改之间二选一。私有开发 bundle 为产品组合提供独立不可变层。

**无条件刷新 presets 与 links。** 否决，因为同名目录可能含有用户修改，也可能指向另一个 checkout。记录的 digest 与精确 target 会显式暴露 drift，并要求替换前先备份。

**接管任何名为 `clawdsh` 的 profile。** 否决，因为名称不是 ownership evidence。闭合 manifest、digest、symlink、package-identity 与单 checkout 检查能阻止安装器认领无关用户数据。

**不做完整备份，直接原地迁移。** 否决，因为 profile、preset、symlink、dependency-tree 与 marker 变更横跨多条路径。Backup-before-mutation 加 marker-last publication 提供可恢复所有权。

## 影响

源码与公共 ClawDSH 安装可以在一个账号下运行，且不共享 profile、preset、Settings、凭据或产品数据状态。Source refresh 会更新产品自有 wiring，同时精确保留用户 patch；修改过的开发 presets 或 links 需要显式仅属主可访问备份。

`.clawdsh-dev.json` 与 `source-backup.json` schema v1 成为候选版本磁盘格式。它们的闭合 inventory、路径约束、负面所有权保证与 marker-last transaction 顺序仍是未来 installer 变更的活跃设计约束；新的字段集合或更宽接管规则需要显式迁移决策。

历史 source migration 有意保持狭窄。未知布局需要手动恢复，source-backup manifest 会记录但不会自动重建旧 symlink。它放弃强制模式，换取绝不把含糊的同名 tree 视为安装器所有。
