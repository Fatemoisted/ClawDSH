# `@clawdsh/cli`

[English](README.md) | 中文

`@clawdsh/cli` 通过精确依赖 `@deepseek-ai/dsh@0.1.0-rc.6` 与 `@clawdsh/dsh-bundle@0.1.0-rc.1`，安装、校验、升级并启动本地 ClawDSH 产品。本包是候选发行版：请使用 npm 的 `next` tag，并预期命令与磁盘格式会在稳定版前发生变化。

## 前置要求与安装

受支持的 Node.js engine 是 `22.19.x` 或 `>=24.0.0`。打开 UI 无需密钥；只有运行依赖模型的操作时才需要模型密钥。

无需全局安装即可运行：

```sh
npx --yes @clawdsh/cli@next
```

也可以全局安装当前候选版本：

```sh
npm install --global @clawdsh/cli@next
clawdsh
```

两个入口都会执行幂等的托管初始化或升级，再启动 `clawdsh` profile。Harness home 默认为 `~/.dsh`；可在命令前设置 `DSH_HOME`，选择另一个绝对路径或 `~/...` 路径。ready line 会打印产品地址，通常是 `http://127.0.0.1:3080/clawdsh/`。

## 命令参考

| 命令 | 行为 |
|---|---|
| `clawdsh` | 初始化或升级受管产品，再以前台进程启动 |
| `clawdsh init` | 初始化或升级，但不启动 dsh |
| `clawdsh init --reset-preset` | 备份每个无标记或已修改的受管同名 preset，再恢复发行版副本 |
| `clawdsh start` | 启动已有 `clawdsh` profile，不执行安装或修复 |
| `clawdsh start --profile <name>` | 启动其他 profile，不接管或修改它 |
| `clawdsh doctor` | 校验管理标记以及安装器所有的 profile、bundle 与 presets |
| `clawdsh migrate source` | 检查旧 source-linked ClawDSH 安装，不执行持久写入 |
| `clawdsh migrate source --apply` | 备份并迁移已知干净 source 安装 |
| `clawdsh migrate source --apply --backup-modified` | 备份并迁移 source-owned 资产已修改的已知布局 |
| `clawdsh channel install` | 显式获取并组装锁定的 production OpenClaw runtime |
| `clawdsh channel doctor` | 校验受管 OpenClaw artifact、runtime、bridge、Node engine 与 fail-closed policy |
| `clawdsh --help`、`clawdsh --version` | 打印命令帮助或 CLI 候选版本号 |

`--backup-modified` 只能与 `--apply` 同时使用。启动命令接受 `--host <host>`、`--port <port>` 与可重复的 `--trusted-host <host>`；`--host` 和 `--port` 各自只能出现一次。未知命令、flag、缺失值、非法 profile name 与其他所有 dsh 参数都会在启动前失败。

## 安装、升级与重置

初始化过程拥有 `$DSH_HOME` 下的这些路径：

- `profiles/clawdsh/package.json` 与其中已安装的 `node_modules` 依赖树；
- `.agent-presets/clawdsh` 与 `.agent-presets/clawdsh-messaging-safe`；
- `.clawdsh.json`，即公共管理标记。

Profile 依赖顺序固定为 `@deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @clawdsh/dsh-bundle`。安装过程使用公共 npm registry、禁用生命周期脚本、从 npm 子进程中移除环境里的 key／secret／token／password 变量，也不接受用户提供的 registry 覆盖。

安装器会先暂存并校验完整候选内容，再替换受管路径。私有 transaction journal 会把既有受管目标移开、发布候选内容，并最后写入 `.clawdsh.json`。后续管理命令会先恢复中断的 transaction，再开始新工作。并发 mutation 命令会因管理锁而失败，不会交错执行。

Profile 的 `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` 是用户层。干净安装会以仅属主可访问的权限创建空文件；普通升级替换受管 manifest 与依赖树，但逐字节保留该 patch。安装器同样不会改动 Settings、凭据、Sessions、Memory、Skills、Activity、OpenClaw 配置或 OpenClaw state。

无标记的同名 profile 绝不会被接管。无标记或已修改的 preset 会阻断普通初始化，因为其中可能包含用户工作。`init --reset-preset` 会先把每个受影响 preset 复制到 `.agent-presets/<id>.backup-<timestamp>-<digest>/`，再恢复发行版副本。该 flag 不会重置 `settings.yaml`、凭据、Memory、Sessions、OpenClaw state 或用户 profile patch；namespace setting 需要从 Settings UI 重置。

如需更新全局安装，请安装新的 `next` 版本并运行完整性检查：

```sh
npm install --global @clawdsh/cli@next
clawdsh init
clawdsh doctor
```

无需安装的 `npx --yes @clawdsh/cli@next` 入口会解析当前 `next` 版本，并执行同一套托管升级。ClawDSH 不为该候选版本发布或记录稳定 npm `latest` 入口。

## 启动生命周期

CLI 从自己精确依赖的 `@deepseek-ai/dsh` 启动 `dsh` 可执行文件；它绝不从 `PATH` 搜索其他 dsh。`start --profile <name>` 会选择已有 profile，但不会把它标记为 ClawDSH 托管。

dsh 运行期间，CLI 始终作为其前台监督进程。它继承标准输入／输出／错误，转发 `SIGINT`、`SIGTERM` 与 `SIGHUP`，等待 dsh 关闭，再镜像终端信号。因此停止 wrapper 不会故意遗留脱离管理的 Harness 进程。

## 配置与凭据

CLI 管理产品组装，不管理用户配置。权威用户配置域为：

| 配置域 | 位置 |
|---|---|
| 非密钥产品设置 | `$DSH_HOME/settings.yaml` |
| DeepSeek 与 Ark 凭据 | `$DSH_HOME/.credentials.yaml`、继承环境与 `.env` 层 |
| 高级组合覆盖 | `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` |
| OpenClaw 平台账号与策略 | `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` |

`doctor` 只读取安装器所有的元数据与文件系统身份，不打开凭据存储。Channel 命令会保留平台凭据值，且不会返回或记录凭据字段。[根配置与密钥指南](../../../../../README.md#credentials)解释优先级、生效时间、全部 4 个配置域与备份范围。

## 源码安装迁移

已识别的历史 ClawDSH 源码布局在公开 `$DSH_HOME` 中包含一个 profile、两个 presets 与 11 个扁平 package symlink。普通 `init` 会拒绝该 footprint，并打印精确迁移命令，而不是覆盖它。

先运行检查：

```sh
clawdsh migrate source
```

检查过程只读取历史 profile、两个同名 preset 与已知 symlink。布局分类如下：

| 结果 | 含义 | 允许的下一步 |
|---|---|---|
| `ready` | 完整已知 manifest、patch、presets、package identity 与单 checkout symlink 集合匹配 | `clawdsh migrate source --apply` |
| `modified` | 布局已知，但 source-owned patch、preset 或额外 profile entry 不同 | `clawdsh migrate source --apply --backup-modified` |
| 未知／拒绝 | identity 缺失或不同、link 不是 symlink、link 跨 checkout、存在 public／dev marker，或资产集合不完整 | 不接管；手动检查并解决 |

每次应用迁移都会先在 `$DSH_HOME/.clawdsh-backups/source-<UTC timestamp>-<digest>/` 创建仅属主可访问的备份，再发布托管安装。备份包含历史 `profile/`、两个 `presets/`，以及 schema v1 `source-backup.json`；该 manifest 记录证据摘要、修改资产清单，以及每个已知 symlink 的原始／解析后目标和 package identity。

迁移 transaction 会替换已知 profile 与 presets，只移除 11 个已识别的扁平 link，并最后发布公共 `.clawdsh.json` 标记。完成前失败会恢复此前目标。迁移绝不读取、移动或改写 `settings.yaml`、`.credentials.yaml`、Sessions、Memory、Skills、Activity 或 OpenClaw state。

## Channel runtime

`init` 绝不下载 OpenClaw。`channel install` 是唯一的受管获取路径。它要求当前 Node 可执行文件满足锁定的 Gateway engine，只接受已检查的 production artifact，校验 SHA-512 与每个 archive entry，使用 npm `10.9.7`、禁用生命周期脚本并组装锁定依赖树，校验已安装 package 与 Host tree，复制 stable bridge，并且只在 OpenClaw 配置不存在时创建无凭据的 fail-closed 配置。Canary 证据不能进入该路径。

WebUI 与 Gateway 默认使用同一套兼容 Node 可执行文件；npm pin 是 assembly 工具，而不是第二套 Node 安装。已有 OpenClaw 配置与 state 会被保留。平台账号与凭据只能通过 OpenClaw 自有设置加入；完成后在 ClawDSH Settings 启用 Gateway 并重启。

`channel doctor` 会校验 production artifact、runtime 依赖集合、Host tree、bridge、当前 Node engine 与 Provider 自有的完整 fail-closed 配置策略。它不能证明平台账号已经登录，也不表示 cataloged Channel 已 installable、certified、enabled 或获得支持。

## 备份与恢复

- **运维备份：** ClawDSH 停止运行时，为完整 `$DSH_HOME` 与外部 Skills Hub `managedDir`（默认 `~/.clawdbot/skills`）创建快照。任何包含 `.credentials.yaml` 的副本都必须只允许 owner 访问。
- **Preset reset 备份：** `init --reset-preset` 只把受影响 preset 保存到 preset root 旁边。它是用户修改的恢复副本，不能替代完整 home。
- **Source migration 备份：** 仅属主可访问的 `.clawdsh-backups/source-*` 目录只保存历史 source-owned profile、两个 presets 与 symlink 证据；它有意排除全部产品数据与密钥。
- **恢复：** 不提供自动 `clawdsh restore` 命令。只能在进程停止时把完整运维快照恢复到原定 home，保留所有权与权限，再运行 `clawdsh doctor`。安装器备份中的文件应恢复到独立检查目录或新的自定义 preset id；把旧 source profile 或已修改 preset 覆盖到受管路径后，`doctor` 会按设计报告完整性差异。

不要在机器之间复制 `.clawdsh.json`，也不要手工重建。该 marker 断言本机精确受管资产；先另存用户修改的 preset，再使用 `clawdsh init` 创建或修复托管安装。

## 失败语义

| 失败 | 结果 |
|---|---|
| 未知或无标记的同名资产 | 拒绝，不接管、删除或修改 |
| 已修改的受管 preset | 拒绝，除非 `init --reset-preset` 显式要求备份并替换 |
| 已修改的已知 source 安装 | 拒绝，除非 `--apply --backup-modified` 显式授权完整备份与迁移 |
| 未知 source 布局 | 始终拒绝；不存在强制 flag |
| 非法 bundle、依赖、archive、path、symlink、digest 或 Node engine | 在受影响的托管状态发布前失败关闭 |
| 中断的多路径 transaction | 可行时立即回滚，并在下一条管理命令前恢复 |
| dsh 启动错误或非零退出 | 报告为 CLI 非零退出；不受支持的参数绝不会透传 |

所有诊断都会点明失败对象与修正方式，同时不打印密钥值。CLI 绝不静默降级、接管外来 profile、修复已修改 preset 或启用 Channel。

## 模型体验

无。本包安装并启动 Host 资产，不增加模型可见上下文。

#### KV Cache 影响

无。安装、迁移与诊断不会创建模型请求，也不会改变活跃 Session 的请求前缀。

## 已知限制与延后工作

- **候选版本磁盘格式可能变化**：`.clawdsh.json` 与 source-backup manifest schema v1 尚无稳定版兼容承诺。
- **没有自动卸载或恢复命令**：所有权有意失败关闭；恢复路径仍是运维快照与显式文件恢复。
- **Production Channel runtime 受平台锁定**：不支持的操作系统、架构、Node engine、artifact 或依赖组合会失败关闭。
- **存在于 catalog 不表示平台支持**：真实平台使用仍需要 OpenClaw 自有凭据，以及独立的 installability、认证与 certification 证据。
