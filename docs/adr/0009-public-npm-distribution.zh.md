# ADR-0009：通过托管本地安装进行公共 npm 分发

[English](0009-public-npm-distribution.md) | 中文

- **状态**：已接受（2026-08-15）；ADR-0010 已规定惰性 bootstrap，且尚未授权真实发布
- **日期**：2026-08-15
- **取代**：ADR-0004；ADR-0006 决策 5 及其相关 registry 表述
- **依赖**：ADR-0006、ADR-0007、ADR-0008
- **Bootstrap 由其细化**：ADR-0010（2026-08-17）

## 上下文

ClawDSH 本地产品现在由 11 个可复用包、可安装 profile layer、托管 preset、Control Runtime、浏览器资产、语义 Activity 和锁定的 OpenClaw 通信平面装配组成。ADR-0004 的私有 registry 过渡无法提供一条命令完成的公共安装、可复现产品资产、托管修复或 npm provenance。ADR-0006 刻意把源码形态与 registry 可达性分开；本决策现在选择公共分发模型，同时保留独立的人工授权门禁，用于把仓库设为 public 和执行首次发布。

公共分发跨越两条不同的信任路径。软件包发布必须证明 13 个 tarball 只包含声明过的不可变资产和精确的 ClawDSH 依赖版本。本地安装必须保留用户拥有的设置、凭据、Memory、Skills、OpenClaw state 和自定义 profile patch，同时只修复此前标记为 ClawDSH 托管的资产。Channel 安装还会下载由 ADR-0008 治理身份的大型第三方 runtime，因此普通产品初始化不得隐式获取或执行它。

当前 13 个公共包名都不存在于 npm registry。npm 要求 package 已存在后才能通过 `npm trust` 配置 trusted publisher，staged publishing 也要求 package 已存在。因此发行状态是 `bootstrap-required`，而不是 `OIDC-ready`；检入 workflow YAML 和 `id-token: write` 本身不构成发布权限。

## 决定

### 1. 发布闭合的 13 包集合

首个公共候选版本是 `0.1.0-rc.1`，在全部发行门禁通过后才以 `next` tag 发布到公共 npm registry。发布集合精确为：

1. `@clawdsh/dsh-soul`
2. `@clawdsh/dsh-embeddings`
3. `@clawdsh/dsh-embeddings-ark`
4. `@clawdsh/dsh-memory`
5. `@clawdsh/dsh-skills-hub`
6. `@clawdsh/dsh-automation`
7. `@clawdsh/dsh-channel`
8. `@clawdsh/dsh-channel-agent`
9. `@clawdsh/dsh-channel-openclaw`
10. `@clawdsh/dsh-activity`
11. `@clawdsh/dsh-preset-messaging-safe`
12. `@clawdsh/dsh-bundle`
13. `@clawdsh/cli`

已移除的 `channel-core`、`channel-feishu` 与 `channel-telegram` package name 继续保留在发行 denylist 中。源码 manifest 对发布集合内部依赖使用 `workspace:0.1.0-rc.1`；打包后的 manifest 必须包含精确 `0.1.0-rc.1`，且不得包含 `workspace:`、`file:`、symlink、私有 registry URL 或未声明资产。CLI 精确依赖 `@deepseek-ai/dsh@0.1.0-rc.6`；兼容失败会阻塞候选版，而不是把版本改成 `latest` 或范围。

### 2. 让 bundle 成为不可变产品层

`@clawdsh/dsh-bundle` 携带 profile patch、托管 `clawdsh` preset、Control Runtime、构建后的 `/clawdsh/` 浏览器资产、Activity runtime 依赖、受限 messaging preset 依赖、生产 Channel host/catalog/support/governance locks、stable bridge 与第三方 notices。其 profile 元数据把 bundle 顺序固定为 `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`，并为每层指定精确版本。

Bundle 从真实且当前的构建产物装配到全新的 stage 目录。闭合资产 manifest 记录每个交付文件的大小和 SHA-512。Staging 拒绝陈旧构建、symlink、路径逃逸、source map、legacy 包，以及依赖或 lock 不一致。校验会对真实 npm tarball 再运行一次；在源码目录直接执行 `npm pack` 会 fail closed，因此只能发布 staged package。

### 3. 赋予 CLI 狭窄的托管安装权限

`@clawdsh/cli` 提供 `clawdsh`、`init`、`start`、`start --profile <name>`、`doctor`、`init --reset-preset`、`channel install` 与 `channel doctor`。无子命令时，它先执行幂等的初始化或升级，再通过 CLI 自身的精确 dsh 依赖启动托管 `clawdsh` profile。`--host`、`--port` 与 `--trusted-host` 原样透传。自定义 profile 只启动，绝不接管为 ClawDSH 托管 profile。

初始化在 staging 目录下构造完整候选，校验 bundle 顺序和每项托管资产摘要，再在平台允许处原子发布候选。`.clawdsh.json` 记录安装器版本、bundle 身份、托管资产与 preset 摘要以及 Channel runtime 状态。既有用户 settings、credentials、memory、skills、OpenClaw config/state 和自定义 profile patch 均不在安装器权限内。没有管理标记的同名 profile 或 preset 绝不会被静默接管。`--reset-preset` 只有在先创建带时间戳和摘要的备份后才会替换无标记或已修改的 preset。旧 `openclaw` 身份只产生警告，不会被删除。

`doctor` 在不访问 credential store 的情况下报告完整性与修复建议。普通 `init` 不下载 OpenClaw runtime。`channel install` 先要求当前 Node 可执行文件满足已锁定 Gateway engine，再只显式下载已检入 host lock 中的 production artifact，校验 SHA-512，使用已检入 runtime dependency lock 和 stable bridge 装配，并创建不含平台凭据、fail closed 的配置。Channel install 与 doctor 把完整配置策略委托给已安装 Provider 检查，但不选择、返回或记录凭据字段。Canary 输入继续只用于审计。

### 4. 只通过 artifact-first OIDC 工作流发布

ClawDSH 工作流固定公共 registry、软件包 allowlist、拓扑顺序、Node 24、4 GiB heap、候选版本和 `next` tag。它不接受 registry 输入，使用 npm trusted publishing、`id-token: write` 和 provenance；禁止长期 npm 写 token。任何远端写入前，先构建和测试产品、stage bundle、创建全部 13 个真实 tarball、校验不可变 release manifest，并通过隔离的临时 registry 与 DSH home 安装它们。

首次创建 package 使用 ADR-0010 的独立一次性流程。它以 `bootstrap` tag 使用确定性的纯 metadata `0.1.0-rc.0` archive，需要用户另行授权精确 archive 集合、public repository 转换与 registry 写入，再由受 2FA 保护的交互式 npm 账号逐包执行。只读远端检查只会在每个既有 integrity 都匹配闭合 bootstrap index 且 `latest` 继续不存在时恢复中断流程。该流程不消耗 `0.1.0-rc.1`；后者继续专供本 OIDC workflow。本次实现生成并校验 bootstrap artifact，但不发布它们。

全部 13 个 package object 存在后，maintainer 为每个 package 配置并校验一条 trusted-publisher 记录。每条记录必须指向相同 GitHub repository、workflow 文件名 `clawdsh-publish.yml`、environment `npm` 和 `npm publish` 权限。GitHub `npm` environment 必须只允许 canonical `clawdsh` branch 部署，workflow 还会独立要求精确 ref `refs/heads/clawdsh`；tag 与其他 branch 都不是发布权限来源。只有这套状态完整时才是 `OIDC-ready`。

只有 bootstrap 已完成、13 条 trust 记录与 `npm` environment branch rule 全部验证、`@clawdsh` scope ownership 已确认、精确 dsh compatibility smoke 通过、仓库已经 public，且用户另行授权本次发行时，workflow 才允许 publish。本次实现不改变仓库可见性、不创建 npm package、不配置 trust，也不执行 npm publish。在全部条件满足前，workflow 保持 preparation 与 dry-run 路径。

## 影响

- 用户获得一个精确、可修复的产品安装，不再需要装配开发 symlink 或逐个插件。
- Bundle 与 CLI 成为安全敏感的发行组件。它们的闭合 manifest、staging transaction、保留规则与 tarball 测试是发布门禁，而非尽力而为的检查。
- Channel runtime 获取保持显式且可独立校验；普通 GUI 安装维持小型、无密钥，并在 npm 依赖已存在后可离线运行。
- 发布节奏独立于上游，但每个候选版绑定一个已测试 dsh 版本。升级 dsh 需要新的兼容结果和候选版。
- 公共 npm 可达性本身不授权公开私有源码。Provenance 让 public repository 授权成为硬前置条件，而不是本 ADR 隐含的副作用。
- 首次创建 package name 是例外的人工 bootstrap。只有逐包 trust 记录与 branch-restricted `npm` environment 全部验证后，常规发行才获得 OIDC 权限。

## 备选方案

- **继续使用参数化私有 registry**：否决，因为它无法提供预期的公共安装、trusted provenance 或稳定消费路径。
- **发布 `packages/openclaw/` 下自动发现的全部 workspace 包**：否决，因为目录发现可能意外纳入 legacy 或内部包；发布集合使用显式 allowlist。
- **让 `init` 自动下载并启动 OpenClaw**：否决，因为大型第三方可执行物和平台平面需要显式用户意图与独立完整性校验。
- **升级时覆盖被修改的托管资产**：否决，因为安装器在未报告冲突和提供先备份修复前，无法区分有意修改与损坏。
- **使用浮动 dsh 版本**：否决，因为产品壳和 profile 依赖精确的预览 API；兼容性必须针对单一发行版复现。
- **使用长期 npm token 或可配置 registry**：否决，因为 trusted publishing 能收窄凭据暴露，固定 registry 可防止公共发布被重定向。
- **使用 staged publishing 创建 package name**：否决，因为 npm 要求 package 已存在后才能 stage；首次创建必须使用另行授权的交互式 2FA 发布。
