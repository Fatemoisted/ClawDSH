# 一次性 npm bootstrap 操作手册

[English](README.md) | 中文

本手册用于创建 13 个公共 `@clawdsh` package identity，且不消耗功能候选版 `0.1.0-rc.1`。它不授权改变仓库可见性，也不授权写入 npm。

## 安全属性

- Bootstrap 版本为 `0.1.0-rc.0`，dist-tag 为 `bootstrap`。
- 生成、校验与发布均使用两个 release workflow 固定的 Node `24.19.0`。
- 每个 archive 只含 `package.json`、`LICENSE` 和警示 `README.md`，不含代码、依赖、可执行文件、exports、入口或生命周期脚本。
- `bootstrap-index.json` 闭合精确 allowlist，并记录每个 archive 的大小与 SHA-512 integrity。
- 只读 registry 检查会拒绝不可变版本不匹配、错误的 `bootstrap` tag 或任何 `latest` tag。它只打印下一条命令，绝不自行发布。
- 功能版 `0.1.0-rc.1` 继续专供 OIDC workflow，并只使用 `next` tag。

## 准备与复核

在仓库根目录创建一个全新输出目录并校验：

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/secret-history-audit.mjs --base upstream/master --head HEAD
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-pack.mjs --repository-root . --output /absolute/new/clawdsh-bootstrap
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-verify.mjs /absolute/new/clawdsh-bootstrap
```

只读 `clawdsh-bootstrap` workflow 会生成同一份已审查 artifact。使用下载副本前应比较其中的 `bootstrap-index.json`。从完成 bootstrap 到发布 `0.1.0-rc.1`，仓库必须保持在该已审查 commit；修改 license 或 bootstrap 契约会改变不可变 archive 的字节，并应触发 integrity 失败。

## 仅在另行授权后发布

仓库必须已经公开、精确 artifact 集合必须已经获批、npm 账号必须拥有 `@clawdsh`，并启用交互式双因素认证。不要向仓库或 workflow 添加长期 npm 写 token。

运行 registry inspector：

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-publication.mjs --directory /absolute/new/clawdsh-bootstrap --repository-root .
```

若某个 package 不存在，inspector 会打印且只打印下一条 `npm publish` 命令，其中固定 public registry、public access 与 `--tag bootstrap`。在另行授权的交互式 npm session 中复核并只执行这一条命令，然后重新运行 inspector。绝不批量循环 13 条命令。只有远端 integrity 与 `bootstrap-index.json` 一致、`bootstrap` 指向 `0.1.0-rc.0` 且不存在 `latest` 时，已发布 package 才会被安全跳过。

13 个 package 全部通过后，记录一份新的只读证据：

```sh
node packages/openclaw/preset-openclaw/distribution/release-tools/bootstrap-publication.mjs --directory /absolute/new/clawdsh-bootstrap --repository-root . --require-complete --attestation /absolute/new/bootstrap-attestation.json
```

随后为 13 个 package 配置并校验 trusted publisher：repository 为 `Fatemoisted/ClawDSH`，workflow 为 `clawdsh-publish.yml`，environment 为 `npm`；该 environment 只允许 canonical `clawdsh` branch。先以 `publish=false` 运行 `clawdsh-publish`。以后执行 `publish=true` 仍要求全部显式 readiness confirmation，会在受保护 environment 授权后重新检查实时 bootstrap 状态，也不会再次发布任何 bootstrap archive。

若任一 integrity 或 tag 检查失败，应立即停止。不得覆盖不可变 npm 版本、移动 `latest`、绕过不匹配重新生成，或自动重写 Git 历史。
