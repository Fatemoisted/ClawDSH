# `@clawdsh/cli`

[English](README.md) | 中文

`@clawdsh/cli` 通过精确依赖的 `@deepseek-ai/dsh@0.1.0-rc.6` 安装、校验并启动本地 ClawDSH 产品。本包是候选发行版；首个稳定版本发布前，磁盘上的管理格式可能发生变化。

## 命令

```text
clawdsh
clawdsh init
clawdsh init --reset-preset
clawdsh start
clawdsh start --profile <name>
clawdsh doctor
clawdsh channel install
clawdsh channel doctor
```

无参数命令会以幂等方式完成受管初始化并启动 `clawdsh` profile。`start --profile <name>` 只启动指定 profile，绝不接管它。启动命令接受 `--host`、`--port` 和可重复的 `--trusted-host`；其他参数不会透传给 dsh。dsh 运行期间，CLI 始终作为其前台监督进程：它转发 `SIGINT`、`SIGTERM` 与 `SIGHUP`，等待 dsh 关闭，再镜像终止信号，避免关停后遗留脱离管理的 Harness 进程。

## 受管数据

初始化过程负责管理 `clawdsh` profile manifest 与已安装的 profile 依赖、`clawdsh` 和 `clawdsh-messaging-safe` preset，以及 `$DSH_HOME/.clawdsh.json`。安装器先暂存并校验完整候选内容，再发布这些资产，最后写入管理标记。下一个命令会回滚被中断的事务。

安装器绝不替换 profile 的 `cordis.patch.yml`、Settings、credentials、memory、skills、OpenClaw 配置或 OpenClaw 状态。它拒绝接管任何没有管理标记的同名 profile 或 preset。`init --reset-preset` 只有在先将无标记或已修改的 preset 复制到带时间戳和摘要标记的备份后才会替换它。旧 `openclaw` 资产只会触发警告，不会被修改。

Profile 依赖安装固定使用公共 npm registry，并禁用生命周期脚本。用户不能覆盖 registry。安装后的 profile 依次固定 `@deepseek-ai/dsh-base@0.1.0-rc.6`、`@deepseek-ai/dsh-web-app@0.1.0-rc.6` 和 `@clawdsh/dsh-bundle@0.1.0-rc.1` 三层。

## Channel runtime

`init` 不会下载 OpenClaw。`channel install` 是唯一的受管获取路径：它先要求当前 Node 可执行文件满足已锁定 Gateway engine，再只接受已检查的 production 产物，校验 SHA-512 和每个 tar 条目，在禁用脚本的情况下按已检查的 runtime lock 完成装配，校验已安装包集合与 Host 文件树，并且只在配置不存在时创建无凭据、失败关闭的配置。Canary 证据仅用于审计，不能进入此安装路径。

Channel 安装器保留已有的 OpenClaw 配置和状态。平台凭据始终归 OpenClaw 所有，绝不进入 ClawDSH 管理标记或命令输出。`channel doctor` 会校验 production 产物、runtime、bridge、当前 Node engine 以及 Provider 所有的完整 fail-closed 配置策略，但不会选择、返回或记录凭据字段。

## 模型体验

无，因为本包安装并启动 Host 资产，不会添加模型可见上下文。

#### KV Cache 影响

无。安装和诊断不会创建模型请求，也不会改变活跃 Session 的请求前缀。

## 已知限制与延后工作

- **Production Channel runtime 受平台锁定** — 只有已检查的 runtime 与 Host 产物能够完成装配和校验时，安装才会成功；不支持的操作系统和架构组合会失败关闭。
- **公共 npm 仍是 `bootstrap-required`** — 13 个 package name 均不存在，因此必须先由用户另行授权交互式 2FA 发布来创建它们，之后逐包 npm trust 才能让发行 workflow 达到 `OIDC-ready`；staged publishing 不能创建全新 package。Bootstrap、仓库可见性变更、针对 `clawdsh-publish.yml` 与 environment `npm` 的 trust 配置、只允许 `clawdsh` branch 的限制和真实发行均属于外部步骤，本次未执行。
