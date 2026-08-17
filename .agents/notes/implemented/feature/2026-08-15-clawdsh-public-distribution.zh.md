# Agent Note：ClawDSH 公共分发

Status: implemented

[English](2026-08-15-clawdsh-public-distribution.md) | 中文

[ADR-0009](../../../../docs/adr/0009-public-npm-distribution.md) 管理公共 npm 与托管安装决策。[ADR-0008](../../../../docs/adr/0008-openclaw-channel-plane.md) 继续作为第三方 OpenClaw artifact 和支持证据的权威；本 Note 只描述其显式安装器路径。[源码开发与迁移决策](../architecture/2026-08-17-clawdsh-source-development-and-managed-migration.md)拥有独立开发 home 与历史 source 转换。

## 问题

此前实现的 ClawDSH profile 依赖 workspace link 与检出目录的构建产物。这足以用于开发，却无法提供干净的公共安装、证明交付了哪些浏览器与 Channel 资产、在不覆盖用户数据的前提下修复托管 preset，或验证与已发布 dsh 版本的兼容性。旧工作流还接受任意私有 registry 与长期写 token，并按目录而非闭合产品发布集合发现软件包。

分发还带来本地权限问题。产品安装器需要创建和升级自己的 profile、preset、runtime 与管理记录，但不得把 settings、credentials、memory、skills、OpenClaw state、自定义 patch 或没有标记的同名 profile 当作安装器所有。跨多个路径的更新失败后，管理 marker 不得声称只完成了一部分的安装；被修改的 preset 也不得被静默替换。

## 决定

公共候选版是固定的 13 包集合，版本统一为 `0.1.0-rc.1`：10 个功能包、受限 messaging preset、`@clawdsh/dsh-bundle` 与 `@clawdsh/cli`。旧 Channel 包继续保持 private。公共包之间的每个 ClawDSH 依赖在源码中使用 `workspace:0.1.0-rc.1`，并且必须在真实 tarball 中变成精确版本。发布校验会拒绝意外公共包、legacy 依赖、错误拓扑顺序、本地依赖协议、symlink、未声明文件、source map 或私有 registry URL。

Staged bundle 是不可变产品层。它从私有开发 bundle 读取产品组合，只为已发布 Control Runtime 改写开发 runtime mount，然后复制托管主 preset、当前构建的 Control Runtime 与浏览器资产、生产 Channel locks、stable bridge、runtime dependency lock、许可证与 notices。闭合的 `assets.json` 为每个交付文件记录来源、角色、字节数与 SHA-512。Staging 要求当前真实构建、仓库内的普通文件、精确公共源码包版本，以及 profile、host lock、runtime lock 与 bridge 之间的一致性。同一组闭合 payload 检查还会对真实 npm archive 再运行。直接 pack 源码模板会 fail closed。

CLI 精确依赖 `@deepseek-ai/dsh@0.1.0-rc.6` 与候选 bundle。其托管 profile 按固定顺序和精确版本安装 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与 ClawDSH bundle。无子命令时先初始化或升级，再启动产品；显式命令覆盖初始化、启动、doctor、preset reset、source migration、Channel install 与 Channel doctor。Start 只把支持的 host、port 与 trusted-host 参数传给 CLI 自有 dsh executable，而带名字的自定义 profile 绝不会被接管为托管 profile。CLI 始终作为前台监督进程，把终端信号转发给 dsh，等待子进程关闭后再镜像该信号；终止 wrapper 因此不会遗留孤立的 Harness 进程或其继承的输出流。

初始化先校验 CLI 自带 bundle 及其资产 manifest，再在私有 transaction 目录下构建完整的 profile 与 preset 候选。Transaction journal 只允许 DSH home 内的规范化路径，把既有托管 target 移入私有 backup，最后发布管理 marker，并在后续操作前回滚或恢复中断的 transaction。`.clawdsh.json` 记录安装器与 bundle 身份、资产摘要、preset 摘要与 Channel 状态。干净 profile 会得到空用户 patch；普通升级逐字节保留该文件。未标记的 `profiles/clawdsh` 或同名 preset 会被拒绝。`--reset-preset` 只有在先把无标记或改变过的 preset 复制到带时间戳与摘要的 backup 后才会替换它。旧 `openclaw` 身份只产生警告。

`clawdsh migrate source` 只检查闭合的历史 source-owned profile、preset 与 11-symlink 集合。每次应用迁移都会创建完整且仅属主可访问的备份；已知布局含有本地修改时必须显式使用 `--backup-modified`；迁移只移除已识别 link，并使用同一项 marker-last 公共 transaction。未知布局没有强制路径，迁移也绝不打开或移动产品数据与凭据文件。

`doctor` 只校验管理元数据与安装器所有的路径，绝不读取 credential store。普通初始化不获取 OpenClaw。`channel install` 是独立的显式 transaction：它读取 bundle 中的 production lock，拒绝不满足已锁定 Gateway engine 的当前 Node 可执行文件，在不携带 ambient authentication header 的情况下下载不可变 npm artifact，校验 SHA-512 和 archive member，在当前兼容 Node 下调用锁定的 npm `10.9.7` assembly 工具并禁用脚本，校验每个已安装依赖与 OpenClaw 普通文件树，复制 stable bridge，并写入无凭据、fail closed 的配置。因此 WebUI 与 Gateway 默认共用当前 Node 可执行文件；托管部署不包含第二套 Node。Canary 不被接受。Channel install 与 doctor 比较 marker 记录的软件包、lock、已安装 tree 与 bridge 身份，然后调用已安装 Provider 的精确实现检查完整 fail-closed 配置策略，但不选择、返回或记录凭据字段，也不记录配置摘要。

发布工作流使用 Node 24 与 4 GiB heap、字面量 13 包顺序、公共 npm registry、OIDC trusted publishing 和 provenance。任何远端写入前，它会 stage 并 pack 全部 archive、校验不可变 release index、把候选发布到仅 loopback 的无认证临时 registry，并使用全新的 home、npm 配置与 DSH home 执行隔离安装。Smoke 解析精确 dsh 和 bundle 版本，运行 CLI 初始化，校验无密钥 `/clawdsh/` 入口及其可执行资产，然后针对打包安装启动 Chromium。它要求原生 shell 与 ClawDSH footer 已完成呈现，并在写入 version-2 browser-runtime attestation 前拒绝页面异常、console error、产品请求失败与错误 response。Publish-mode candidate artifact 还会携带闭合 `bootstrap/` archives 与 index；受保护 `npm` environment 批准后，publish job 会根据两个 index 重新检查实时 npm，再执行 release readiness 与任何 `0.1.0-rc.1` 写入。

Workflow 会运行 `lint`、`doc-sync` 和 `hygiene` 的每个组成项。上游 `47f943859bef60e4160492346772ded9b24f765a` 的 `rescope-vendor:check` 会报告一组已知 false positive，因为 26 个文件把 `cordis` 用作 event、locale、slot 或生成文档 namespace，而不是 npm package specifier。ClawDSH 不修改上游脚本或这些文件。`tools/verify-clawdsh-rescope-baseline.mjs` 优先接受完全通过的检查；否则只接受该上游 commit、脚本 blob `3f5cb525c2821e37adab4689e59093e361975104`、精确 26 条路径、Markdown 4 文件/38 行、code 22 文件/73 行且没有额外 diagnostic。上游 ref、脚本、路径、计数或 failure 任一漂移都会阻断发行。

Package name 创建使用 `0.1.0-rc.0`、dist-tag 为 `bootstrap` 的确定性 inert 集合。相同 13 个 package name 的每个 archive 都只包含 canonical package metadata、MIT license，以及说明该包不可运行并引导用户使用 `@next` 的 README。Bootstrap archive 不包含 dependency、`bin`、export、entry point、script 或代码文件。闭合的 `bootstrap-index.json` 为每个 archive 记录精确 filename、字节数与 SHA-512。

Bootstrap publication helper 会在不携带凭据的情况下校验公共 npm，而且绝不执行发布。不提供 release index 时，它只接受精确的既有 `0.1.0-rc.0`，要求 `bootstrap` 指向该版本，拒绝包括 `latest` 在内的其他任何 version 或 tag，并且每次只为另行授权的交互式 2FA session 打印一条显式 `npm publish <archive> --ignore-scripts --access public --tag bootstrap` 命令。提供已评审功能 release index 时，它只会额外允许精确的 `0.1.0-rc.1`、`next` 与 SLSA v1 provenance 作为恢复点；无关 version、tag、integrity 或 provenance 仍是冲突。每发布一个 bootstrap 包后重新运行即可恢复流程；完成后会为同一闭合 index 生成 attestation。Bootstrap 生成、每次交互式发布与功能 workflow 使用同一个已评审 commit。修改根 `LICENSE` 或任一 release contract 会改变不可变 tarball SHA-512，因此后续 inspector 与 workflow verification 会拒绝混合 commit 的序列。

Package 创建后，全部 13 条 trusted-publisher 记录指向相同 repository、`clawdsh-publish.yml`、GitHub environment `npm` 与 `npm publish` 权限。该 environment 只允许 canonical `clawdsh` branch，release readiness 还会独立要求 `refs/heads/clawdsh`。OIDC 发布前，仓库与 packages 已公开，让 npm 能签发 provenance。第一次写入前，artifact-first publication helper 会把全部 13 个远端 package state 与 release index 比较，并拒绝 `latest`、错误 integrity、错误 `next`、缺失 provenance 或无关 state。精确的 `0.1.0-rc.1` package 是恢复点；缺失 package 会按依赖顺序以 provenance 发布到 `next`，并在每包之后以及全体完成后重新校验。Workflow 只有在 package trust、scope ownership、compatibility attestation 与一次发行授权全部一致后才运行。

## 验证

Bundle 测试使用真实 `npm pack` 输出，覆盖确定性 staging、精确依赖转换、陈旧输出、symlink、路径逃逸、本地依赖协议、私有 registry、source map、未声明文件与不匹配的 Channel lock。Release-tool 测试覆盖闭合源码包清单、archive parser、拓扑顺序、release index、readiness 条件、loopback registry 限制、浏览器执行的隔离安装 attestation、精确部分发布恢复、冲突远端 state、发布后校验，以及源码／历史 secret scan。

CLI 测试只注入 acquisition、npm、process、clock 与 output effect。它们覆盖干净初始化、精确三层 profile 依赖、第二次运行幂等、拒绝未标记 profile 与未标记 preset、保留用户 patch、拒绝改变过的 preset、reset 前备份、source inspection 与 migration、transaction 回滚与恢复、legacy 警告、支持参数透传、无 secret doctor 输出、显式 Channel 安装、恶意 archive 拒绝、摘要不匹配与 Channel 完整性诊断。发布工作流在 artifact 能进入 publish job 之前，会在 Node 24 上重复产品构建与无密钥 clean-install journey。

Bootstrap 测试会逐字节复现全部 13 个 archive，检查完整 tar entry 集合与 manifest field allowlist，拒绝额外或缺失文件，校验闭合 index，模拟 registry 部分完成后的恢复，拒绝 integrity 与 dist-tag drift，并证明 helper 只返回命令而不执行发布。

精确 baseline verifier 包含无依赖的正反向测试，覆盖完全通过的上游检查、闭合的已知 failure，以及每项已接受 identity、计数、路径、重复项、exit 或 diagnostic 字段的漂移。Workflow 静态断言会固定其余全部 hygiene 命令与由 package 自有的 Playwright 调用。

根目录的逐文件覆盖率门禁会在 Linux 与 Windows 上执行每个 ClawDSH 源文件。行为级用例覆盖文件系统失败、生命周期取消、分页与调度、Channel 完整性与协议状态，以及 memory 刷新竞态；只有当已验证配置、同进程类型调用、生命周期顺序或另一平台的路径语义使分支在当前宿主上不可达时，才保留窄范围 V8 例外。双搜索版本刷新回归证明，memory 排名会跳过尚未生成向量的新索引 chunk，因此一个搜索不会消费另一个搜索尚未完成的 cache。

## 考虑过的备选方案

**扩展开发 linker。**否决，因为 symlink、仓库路径与破坏性修复假设不适合公共软件包安装。

**原地安装或更新文件。**否决，因为 profile、dependency tree、preset 与 marker 之间任一失败都会把部分状态暴露为已托管。候选 staging 和 marker-last publication 提供可恢复的所有权。

**普通初始化时下载 OpenClaw。**否决，因为大型第三方 executable 与其通信平面需要显式意图和独立锁定的完整性证据。

**发布所有被发现的 OpenClaw workspace。**否决，因为 legacy 与内部包不得因目录布局变成公共包。精确 allowlist 让新增项可审查。

**使用可配置 registry 与长期 token。**否决，因为公共发行只有一个 registry，OIDC trusted publishing 能缩短 secret 生命周期，并阻止输入重定向发布。

**直接发布 `0.1.0-rc.1` 创建 package。** 否决，因为在 OIDC 之外消耗不可变功能版本，会阻止 provenance workflow 发布它。更低的 inert 版本可以保留 identity，而不会成为可运行发行版。

**Bootstrap 时让 npm 分配默认 dist-tag。** 否决，因为首次发布会创建 `latest`，并把 inert package 展示为推荐发行版。显式 `bootstrap` tag 与远端 verifier 会让 `latest` 保持不存在。

**在本地应用 rescope rewrite。** 否决，因为拟议改动会重命名持久化的 `cordis/*` event、locale 与 slot namespace，而非 package specifier，并且还会违反上游源码纪律。

**为 RC 跳过 rescope 检查。** 否决，因为无条件跳过会隐藏新的 package-name residue 或上游变更。该例外只接受一个完整 fingerprint，并会在上游检查完全通过后立刻失去必要性。

## 影响

ClawDSH 可以在不修改上游发布机制的前提下，被打包并测试为一个公共、精确版本的产品。干净安装具有狭窄的修复 owner，源码开发继续保持独立，已知历史 source 布局则拥有先备份的转换路径。受管 marker、source-backup manifest、asset manifest、bootstrap index 与 bootstrap attestation 成为候选版本持久格式；不兼容变更需要显式 schema 决策，而不是静默重新解释。

Inert bootstrap 与功能发行有意使用不同发布权限。交互式 2FA 只创建 `0.1.0-rc.0@bootstrap`；OIDC 只通过 provenance 发布 `0.1.0-rc.1@next`，两条路径都不创建 `latest`。更新 dsh、OpenClaw、产品壳或任何公共包都要求重建并重新校验完整发布集合。平台凭据继续只存在于 OpenClaw state，绝不进入 bundle、CLI marker、release attestation 或 doctor 输出。

精确 rescope 例外会临时固定一个上游 commit 与脚本 blob；同步上游时必须让检查完全通过，或有意审查该 fingerprint。它不能授权本地 rescope rewrite 或任何新 diagnostic。
