# Agent Note：ClawDSH 公共分发

Status: implemented

[English](2026-08-15-clawdsh-public-distribution.md) | 中文

[ADR-0009](../../../../docs/adr/0009-public-npm-distribution.md) 管理公共 npm 与托管安装决策。[ADR-0008](../../../../docs/adr/0008-openclaw-channel-plane.md) 继续作为第三方 OpenClaw artifact 和支持证据的权威；本 Note 只描述其显式安装器路径。开发 linker 仍单独记录，不是产品安装器。

## 问题

此前实现的 ClawDSH profile 依赖 workspace link 与检出目录的构建产物。这足以用于开发，却无法提供干净的公共安装、证明交付了哪些浏览器与 Channel 资产、在不覆盖用户数据的前提下修复托管 preset，或验证与已发布 dsh 版本的兼容性。旧工作流还接受任意私有 registry 与长期写 token，并按目录而非闭合产品发布集合发现软件包。

分发还带来本地权限问题。产品安装器需要创建和升级自己的 profile、preset、runtime 与管理记录，但不得把 settings、credentials、memory、skills、OpenClaw state、自定义 patch 或没有标记的同名 profile 当作安装器所有。跨多个路径的更新失败后，管理 marker 不得声称只完成了一部分的安装；被修改的 preset 也不得被静默替换。

## 决定

公共候选版是固定的 13 包集合，版本统一为 `0.1.0-rc.1`：10 个功能包、受限 messaging preset、`@clawdsh/dsh-bundle` 与 `@clawdsh/cli`。旧 Channel 包继续保持 private。公共包之间的每个 ClawDSH 依赖在源码中使用 `workspace:0.1.0-rc.1`，并且必须在真实 tarball 中变成精确版本。发布校验会拒绝意外公共包、legacy 依赖、错误拓扑顺序、本地依赖协议、symlink、未声明文件、source map 或私有 registry URL。

Staged bundle 是不可变产品层。它只改写已检入 profile patch 中的开发 runtime mount，然后复制托管主 preset、当前构建的 Control Runtime 与浏览器资产、生产 Channel locks、stable bridge、runtime dependency lock、许可证与 notices。闭合的 `assets.json` 为每个交付文件记录来源、角色、字节数与 SHA-512。Staging 要求当前真实构建、仓库内的普通文件、精确公共源码包版本，以及 profile、host lock、runtime lock 与 bridge 之间的一致性。同一组闭合 payload 检查还会对真实 npm archive 再运行。直接 pack 源码模板会 fail closed。

CLI 精确依赖 `@deepseek-ai/dsh@0.1.0-rc.6` 与候选 bundle。其托管 profile 按固定顺序和精确版本安装 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与 ClawDSH bundle。无子命令时先初始化或升级，再启动产品；显式命令覆盖初始化、启动、doctor、preset reset、Channel install 与 Channel doctor。Start 只把支持的 host、port 与 trusted-host 参数传给 CLI 自有 dsh executable，而带名字的自定义 profile 绝不会被接管为托管 profile。CLI 始终作为前台监督进程，把终端信号转发给 dsh，等待子进程关闭后再镜像该信号；终止 wrapper 因此不会遗留孤立的 Harness 进程或其继承的输出流。

初始化先校验 CLI 自带 bundle 及其资产 manifest，再在私有 transaction 目录下构建完整的 profile 与 preset 候选。Transaction journal 只允许 DSH home 内的规范化路径，把既有托管 target 移入私有 backup，最后发布管理 marker，并在后续操作前回滚或恢复中断的 transaction。`.clawdsh.json` 记录安装器与 bundle 身份、资产摘要、preset 摘要与 Channel 状态。升级时既有用户 patch 保持原位。未标记的 `profiles/clawdsh` 或同名 preset 会被拒绝。`--reset-preset` 只有在先把无标记或改变过的 preset 复制到带时间戳与摘要的 backup 后才会替换它。旧 `openclaw` 身份只产生警告。

`doctor` 只校验管理元数据与安装器所有的路径，绝不读取 credential store。普通初始化不获取 OpenClaw。`channel install` 是独立的显式 transaction：它读取 bundle 中的 production lock，拒绝不满足已锁定 Gateway engine 的当前 Node 可执行文件，在不携带 ambient authentication header 的情况下下载不可变 npm artifact，校验 SHA-512 和 archive member，在当前兼容 Node 下调用锁定的 npm `10.9.7` assembly 工具并禁用脚本，校验每个已安装依赖与 OpenClaw 普通文件树，复制 stable bridge，并写入无凭据、fail closed 的配置。因此 WebUI 与 Gateway 默认共用当前 Node 可执行文件；托管部署不包含第二套 Node。Canary 不被接受。Channel install 与 doctor 比较 marker 记录的软件包、lock、已安装 tree 与 bridge 身份，然后调用已安装 Provider 的精确实现检查完整 fail-closed 配置策略，但不选择、返回或记录凭据字段，也不记录配置摘要。

发布工作流使用 Node 24 与 4 GiB heap、字面量 13 包顺序、公共 npm registry、OIDC trusted publishing 和 provenance。任何远端写入前，它会 stage 并 pack 全部 archive、校验不可变 release index、把候选发布到仅 loopback 的无认证临时 registry，并使用全新的 home、npm 配置与 DSH home 执行隔离安装。Smoke 解析精确 dsh 和 bundle 版本，运行 CLI 初始化，并等待无密钥 `/clawdsh/` ready URL。

当前 registry 状态是 `bootstrap-required`：13 个 package name 均不存在，npm 也不允许对全新 package 使用 `npm trust` 或 staged publishing。因此首次创建需要用户另行授权，并由启用 2FA 的 npm 账号通过交互式会话直接发布。Bootstrap archive 与版本刻意保持未选择，因为在 OIDC 之外消耗 `0.1.0-rc.1` 会阻止 workflow 发布这个不可变版本。本次实现不执行 bootstrap。

Package 创建后，必须为全部 13 个 package 批量配置 trusted-publisher 记录，并统一指向相同 repository、`clawdsh-publish.yml`、environment `npm` 与 `npm publish` 权限。`OIDC-ready` 状态要求 GitHub `npm` environment 只允许 canonical `clawdsh` branch，release readiness 还会独立要求 `refs/heads/clawdsh`。在这些控制、scope ownership、仓库公开批准与 compatibility attestation 全部一致前，公共发行保持阻塞；本次实现不改变仓库可见性、不配置 trust，也不执行 publish。

## 验证

Bundle 测试使用真实 `npm pack` 输出，覆盖确定性 staging、精确依赖转换、陈旧输出、symlink、路径逃逸、本地依赖协议、私有 registry、source map、未声明文件与不匹配的 Channel lock。Release-tool 测试覆盖闭合源码包清单、archive parser、拓扑顺序、release index、readiness 条件、loopback registry 限制、发布命令构造与隔离安装 attestation。

CLI 测试只注入 acquisition、npm、process、clock 与 output effect。它们覆盖干净初始化、精确三层 profile 依赖、第二次运行幂等、拒绝未标记 profile 与未标记 preset、保留用户 patch、拒绝改变过的 preset、reset 前备份、transaction 回滚与恢复、legacy 警告、支持参数透传、无 secret doctor 输出、显式 Channel 安装、恶意 archive 拒绝、摘要不匹配与 Channel 完整性诊断。发布工作流在 artifact 能进入 publish job 之前，会在 Node 24 上重复产品构建与无密钥 clean-install journey。

## 考虑过的备选方案

**扩展开发 linker。**否决，因为 symlink、仓库路径与破坏性修复假设不适合公共软件包安装。

**原地安装或更新文件。**否决，因为 profile、dependency tree、preset 与 marker 之间任一失败都会把部分状态暴露为已托管。候选 staging 和 marker-last publication 提供可恢复的所有权。

**普通初始化时下载 OpenClaw。**否决，因为大型第三方 executable 与其通信平面需要显式意图和独立锁定的完整性证据。

**发布所有被发现的 OpenClaw workspace。**否决，因为 legacy 与内部包不得因目录布局变成公共包。精确 allowlist 让新增项可审查。

**使用可配置 registry 与长期 token。**否决，因为公共发行只有一个 registry，OIDC trusted publishing 能缩短 secret 生命周期，并阻止输入重定向发布。

## 影响

ClawDSH 现在可以在不修改上游发布机制的前提下，被打包并测试为一个公共、精确版本的产品。干净安装具有狭窄的修复 owner，开发 link 继续保持独立。托管 marker 与资产 manifest 成为持久格式；不兼容变更需要显式 schema 决策，而不是静默重新解释。

首次公共写入仍刻意保持不可用，直到另行授权的 2FA bootstrap 方案、外部所有权、全部 13 条 trusted-publisher 记录、branch-restricted `npm` environment、公共源码 provenance 与发行授权全部存在。Staged publishing 只能在 package 创建后使用，不能满足 bootstrap。更新 dsh、OpenClaw、产品壳或任何公共包都要求重建并重新校验完整发布集合。平台凭据继续只存在于 OpenClaw state，绝不进入 bundle、CLI marker、release attestation 或 doctor 输出。
