# ADR-0010：惰性 npm bootstrap 与公开发布门禁

[English](0010-inert-npm-bootstrap-and-public-gates.md) | 中文

- **状态**：已接受（2026-08-17）；远端发布与仓库可见性变更仍未获单独授权
- **日期**：2026-08-17
- **细化**：ADR-0009 决策 4
- **依赖**：ADR-0006、ADR-0009

## 上下文

ADR-0009 为首个功能性公开候选版保留 `0.1.0-rc.1`，并要求 package 级 trusted publishing；但每个 package identity 存在之前，npm 无法配置 trusted publisher。交互式发布功能候选版会在带 provenance 的 workflow 之外消耗其不可变版本。若仅为创建名称而发布正常 package 内容，又会在常规发布权限建立前暴露可执行代码和依赖边。

仓库改变可见性前还需要一套可审查的公开源码姿态：贡献者必须看到 ClawDSH 的真实接收政策，派生作品版权必须保留双方 notice，仓库 metadata 必须指向 ClawDSH，ClawDSH 分支引入的已提交历史必须接受非修改式密钥检查。这些准备均不授权把仓库改为 public，也不授权写入 npm。

## 决定

### 1. 用惰性 `0.1.0-rc.0` 保留 package identity

一次性 bootstrap 对 `RELEASE_PACKAGES` 中精确 13 个名称按检入顺序使用版本 `0.1.0-rc.0` 和自定义 `bootstrap` dist-tag：`@clawdsh/dsh-activity`、`@clawdsh/dsh-channel`、`@clawdsh/dsh-embeddings`、`@clawdsh/dsh-automation`、`@clawdsh/dsh-skills-hub`、`@clawdsh/dsh-soul`、`@clawdsh/dsh-channel-agent`、`@clawdsh/dsh-channel-openclaw`、`@clawdsh/dsh-embeddings-ark`、`@clawdsh/dsh-memory`、`@clawdsh/dsh-preset-messaging-safe`、`@clawdsh/dsh-bundle` 与 `@clawdsh/cli`。

每个 tarball 精确包含 `package.json`、仓库 `LICENSE` 与 package 专属警示 `README.md`。Manifest 只包含 identity、description、license、repository/homepage/bugs metadata，以及固定为 public access、公共 npm registry 和 `bootstrap` 的 `publishConfig`。它不含 dependencies、`bin`、exports、`main`、scripts、files allowlist、可执行 payload 或代码。README 明确要求用户不要安装 bootstrap，并把 `0.1.0-rc.1` 标识为首个功能候选版。

### 2. 让 bootstrap 字节可复现且闭合

Bootstrap writer 在固定的 Node `24.19.0` 下直接构造 npm tar 格式，固定 path 顺序、mode、uid/gid、timestamp、gzip level 与 gzip platform byte。生成过程要求全新输出目录。`bootstrap-index.json` 以 release allowlist 顺序列出精确 13 个 canonical filename，并记录每个 archive 的 byte length 与 SHA-512 integrity。校验会重新打开每个 archive，把全部三个文件和完整压缩 archive 与生成契约逐字节比较，拒绝任何额外 directory entry 或 manifest field，并要求检入 index 与 archive 一致。

只读 `clawdsh-bootstrap` workflow 会运行历史审计与 bootstrap 测试、生成同一闭合集合、校验并把它上传为短期 artifact。它只有 `contents: read`，没有 npm credential、OIDC 写权限或发布步骤。

### 3. 让例外写入保持人工、单步且可恢复

Bootstrap 发布继续位于 GitHub Actions 之外。仓库可见性变更、精确 archive 集合、npm scope 与远端写入分别获批后，maintainer 使用受交互式 2FA 保护的 npm session。检入的 inspector 不带凭据，只访问 `https://registry.npmjs.org/`。每个已存在的 `0.1.0-rc.0` 都必须满足：远端 `dist.integrity` 与 `bootstrap-index.json` 一致，`bootstrap` tag 指向该版本，且不存在 `latest`。任一不匹配都会中止流程。

若仍有 identity 未创建，inspector 会打印一条显式的 `npm publish <tarball> --ignore-scripts --access public --tag bootstrap --registry https://registry.npmjs.org/` 命令，但绝不执行。Maintainer 复核并只运行这一条，再次运行 inspector。匹配 package 会被跳过，因此中断后的 bootstrap 能从已校验远端状态继续，而不重新发布不可变版本。禁止批量循环、长期 npm 写 token、移动 `latest` 与自动修复。

### 4. 为 `next` 与 OIDC 保留 `0.1.0-rc.1`

功能版继续为 `0.1.0-rc.1`。`clawdsh-publish.yml` 仍默认执行完整只读 dry run。只有 public write job 获得 `id-token: write`，以 provenance 发布已校验功能 tarball，且只接受 `next` tag。它绝不创建或移动 `latest`，也不重新发布 bootstrap archive。

请求 public write 时，workflow 会重新生成惰性 bootstrap 契约并获取只读 registry 证据。受保护的 npm environment 向 publish job 授权后，该 job 会在 readiness 与发布前再次检查 registry 实时状态。除 ADR-0009 规定的 scope、trusted publisher、public repository、兼容性、branch、smoke 与逐次人工确认外，release readiness 还要求已核验的证据匹配闭合 bootstrap index、证明 13 个远端 integrity 与 `bootstrap` tag，并证明不存在 `latest`。

### 5. 完成新增式公开源码治理层

两份 CONTRIBUTING 中的 ClawDSH 前言欢迎 Issue 与 PR，链接 plugin/spec/matrix 门禁，并解释保留的上游 no-PR 原文治理 DeepSeek Harness 而非 ClawDSH。MIT License 保留 DeepSeek notice，并新增 `Copyright (c) 2026 ClawDSH contributors`。根 package metadata 指明 ClawDSH repository、homepage 与 issue tracker。这些继续是根 ClawDSH AGENTS 品牌段记录的新增式、可 rebase 重放上游文件处置。

公开前历史审计会解析显式 upstream mirror ref 与 release head 的 merge base，再扫描完整 ClawDSH commit range 引入的所有 blob，包括先添加、后从当前 tree 删除的 blob。它只报告 rule、path 与 object id，从不输出匹配值。它使用高置信 credential 形式与敏感 filename，不是“绝无密钥”的证明，也从不重写历史。发现问题会中止发布，等待显式 remediation 决策。

## 影响

- 例外交互式发布能创建惰性 package identity，而不消耗或削弱功能候选版。
- 部分完成的 bootstrap 只有在 registry integrity 匹配已审查 artifact 时才能安全恢复；异常不可变状态会 fail closed。
- `bootstrap` 与 `next` 都不会建立稳定 `latest` channel。未来稳定版需要独立版本与决策。
- 公开源码治理与密钥历史审查成为发布门禁，但仓库可见性和 registry 写入仍是用户显式动作。
- Bootstrap 工具与 runbook 作为长期审计材料保留，但成功的 bootstrap 发布只执行一次。

## 备选方案

- **交互式发布 `0.1.0-rc.1`**：否决，因为功能版本将无法再由带 provenance 的 OIDC workflow 发布。
- **使用正常 package payload bootstrap**：否决，因为创建 package name 不需要可执行代码、依赖图或安装权限。
- **Bootstrap 使用 `latest` 或 `next`**：否决，因为惰性 package 既不应表现为稳定 channel，也不应占用功能候选 channel。
- **自动发布全部 13 个 package**：否决，因为例外 registry 写入需要逐步人工控制，并在每次不可变发布后复核 integrity。
- **只看 package 是否存在，不比较 integrity**：否决，因为部分或冲突的旧 bootstrap 不能只凭版本号存在就视为安全。
- **发现密钥后自动重写 Git 历史**：否决，因为 remediation 可能使协作者 ref 与签名历史失效；审计保持只读并中止，等待显式决策。
