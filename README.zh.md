<!-- ═══════════════ ClawDSH PUBLIC LANDING START ═══════════════ -->

# ClawDSH

[English](README.md) | 中文

<p align="center"><img src="packages/openclaw/preset-openclaw/brand/clawdsh-lockup.svg" alt="ClawDSH 潮汐钳鲸标志" width="520"></p>

> **把 OpenClaw 的个人助手能力，重建为可组合、可维护的 dsh 插件。**

ClawDSH 是构建于 DeepSeek Harness（`dsh`）插件运行时之上的本地个人助手产品。它保留原生 Harness 应用作为高级入口，同时提供一套有明确取舍的产品 profile、记忆、skill（技能）、自动化、限制隐私的 Activity 记录，以及可选的 OpenClaw 通信平面。

ClawDSH 是独立社区项目。它构建于 DeepSeek Harness 并与 OpenClaw 互操作，但不代表两方官方背书，也不隶属于其中任何一方。本次发行是 `0.1.0-rc.1`：请使用 npm 的 `next` tag，预期候选版本仍会变化，不要把它当作稳定兼容承诺。

## 三个项目的关系

| 项目 | 在 ClawDSH 中的职责 | 独立所有的内容 |
|---|---|---|
| ClawDSH | 产品 profile、自有插件、托管安装器、`/clawdsh/` UI 与潮汐钳鲸品牌 | ClawDSH 设置、发行生命周期与社区支持 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 基于 Cordis 的 agent（智能体）运行时、模型／工具／Session 服务与原生 Web 应用 | 上游源码、原生 UI 与 `dsh` 架构 |
| [OpenClaw](https://github.com/openclaw/openclaw) | 可选通信平面运行时与平台账号 owner | 平台适配器、账号、凭据、策略与状态 |

ClawDSH 仓库以 `upstream` Git 远程跟踪 DeepSeek Harness。[Harness 上下文与复用地图](docs/specs/context-map.md)解释直接复用的 dsh 能力 seam；[路线图](docs/specs/roadmap.md)与[对齐矩阵](docs/matrix/parity.md)描述 ClawDSH 自有工作。

## 功能与安全默认值

| 功能 | 用户可见行为 | 干净安装状态 |
|---|---|---|
| ClawDSH 模式 | 新产品 Session 使用 `clawdsh` preset，并在原生 dsh 对话 UI 中打开 | 启用 |
| Soul | 加入个人助手提示词层；修改对新 Session 生效 | 启用 |
| Memory 与 Ark 召回 | 把 Markdown 记忆保存到 `$DSH_HOME/memory`；Ark embeddings 提供可选语义召回 | Memory 启用；首次 embedding 调用前无需 Ark key |
| Skills Hub | 加载 workspace skill 与兼容的 `~/.clawdbot/skills` 目录 | 启用 |
| Automation | 在独立 Session 中运行定时 agent 工作 | 关闭 |
| Activity | 解释选定的 Soul、Memory、Skill、Channel 与 Automation 事实，不复制机密或原始平台身份 | 启用且失败不阻断业务 |
| OpenClaw Gateway | 显式安装并配置后提供锁定的外部通信平面 | 关闭 |
| Harness 高级 | 在 `/` 保留未修改的上游应用，用于 preset、原始轨迹与高级控制 | 可用 |

Channel catalog 只代表证据，不代表支持声明。Telegram、飞书、Discord 等条目不会因为出现在 UI 中，就被声明为 installable、certified、enabled 或 ready。ClawDSH 不交付直连平台适配器。

## 快速开始

### 前置要求

- 带 npm 的 Node.js `22.19.x` 或 `>=24.0.0`。
- 一台你信任同一系统用户下 agent 工具的本地机器。打开 UI 不需要模型或平台密钥。

### 通过 npm 启动

```sh
npx --yes @clawdsh/cli@next
```

该命令会在 `$DSH_HOME`（默认 `~/.dsh`）下安装或升级受管 `clawdsh` profile，然后以前台进程启动 Web Host。打开命令打印的地址，通常是 `http://127.0.0.1:3080/clawdsh/`。按 `Ctrl-C` 可停止；launcher 会转发终端信号，并等待 dsh 关闭。

首次运行只创建安装器所有的 profile、preset、依赖与管理文件。它不要求或创建 OpenClaw runtime、平台登录、模型密钥、Memory 事实、Automation 规则或外部 Channel listener。全局安装、自定义 host／port、升级、迁移、备份与失败行为见[完整 CLI 参考](packages/openclaw/preset-openclaw/distribution/cli/README.md)。

## 凭据

ClawDSH 分开管理模型、embedding 与平台凭据，因此不会让一个 UI 或文件变成所有机密的集中存储。

| 凭据 | 填写位置 | 何时需要 | 生效时间 |
|---|---|---|---|
| DeepSeek `DEEPSEEK_API_KEY` | Settings → Models；`$DSH_HOME/.credentials.yaml`；启动环境；或 `.env` | 第一次 DeepSeek 模型或 Web Search 请求 | 受管凭据文件：下一次调用；环境与 `.env`：重启 |
| Ark `ARK_API_KEY` | Settings → ClawDSH → Memory → Ark；`$DSH_HOME/.credentials.yaml`；启动环境；或 `.env` | 第一次 Ark embedding 请求 | 受管凭据文件：下一次调用；环境与 `.env`：重启 |
| 平台账号凭据 | 执行 `clawdsh channel install` 后，通过 OpenClaw 账号设置与 `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` 管理 | 只有显式启用的 OpenClaw 平台 route 需要 | 归 OpenClaw 所有；账号或策略变更后重启 |

本地受管凭据文档是普通 YAML：

```yaml
DEEPSEEK_API_KEY: "<your-deepseek-key>"
ARK_API_KEY: "<your-ark-key>"
```

凭据优先级依次为：继承的启动环境 → `$DSH_HOME/.credentials.yaml` → 调用目录下的 `.env` → `$DSH_HOME/.env`。UI 绝不通过 Settings RPC 返回密钥值；ClawDSH 也绝不把 OpenClaw 平台凭据复制进 dsh 凭据、日志、Session、Activity 或管理标记。

`$DSH_HOME/.credentials.yaml` 以仅属主可访问的权限存放。`0600` 模式能隔离其他操作系统用户，但无法阻止同一 UID 下的 shell 或文件系统工具主动读取该文件。请只在可信主机运行 ClawDSH，不要把密钥写进 `settings.yaml`、profile patch、Issue 或截图，并保护任何包含凭据文档的备份。

## 配置与数据

### 四个配置域

| 配置域 | 权威位置 | 用户入口与优先级 | 所有权规则 |
|---|---|---|---|
| 非密钥产品设置 | `$DSH_HOME/settings.yaml` | Settings → ClawDSH；schema default → 受管 profile base → user settings | ClawDSH 精确暴露 8 个产品 namespace，并把每个字段分类为 editable、managed 或 hidden |
| 模型与 Ark 密钥 | `$DSH_HOME/.credentials.yaml`、启动环境与 `.env` | Settings → Models 或 Memory → Ark；环境优先于受管文件与两层 `.env` | 密钥值绝不进入 `settings.yaml` 或 profile patch |
| 部署组合与高级覆盖 | 已安装 bundle 加 `$DSH_HOME/profiles/clawdsh/cordis.patch.yml` 和 home 级 `$DSH_HOME/cordis.patch.yml` | bundle layer → profile patch → home patch；后应用的层优先 | 安装器拥有 bundle 与依赖树，但逐字节保留用户 patch |
| OpenClaw 账号与策略 | `$DSH_HOME/clawdsh/channel/openclaw/state/openclaw.json` | `clawdsh channel install`，然后使用 OpenClaw 账号与策略工具 | OpenClaw 拥有平台状态；ClawDSH 校验部署身份，但不复制该状态 |

Settings 页面会显示每个字段的 owner 与生效时间。`live` 修改影响已挂载 runtime，`new-session` 修改需要新对话，`next-call` 修改在下一次操作时解析，`restart` 修改会在重启 ClawDSH 后生效。Soul 属于 new-session；Automation 设置 live 生效；Memory 与 Skills provider 变更需要重启；受管凭据文件的变更对下一次调用可见。[生成的配置目录](docs/config-catalog.md)是完整字段参考；README 示例有意只覆盖常用入口。

### 数据位置与备份

| 数据 | 默认位置 | 受管安装或迁移行为 |
|---|---|---|
| 设置与凭据 | `$DSH_HOME/settings.yaml`、`$DSH_HOME/.credentials.yaml` | source migration 绝不读取、移动或改写；Settings 只写入选中 namespace 的 user layer |
| Sessions | `$DSH_HOME/sessions` | 安装、升级、preset reset 与 source migration 均会保留 |
| Memory 与 Activity | `$DSH_HOME/memory`、`$DSH_HOME/clawdsh/activity/v1` | 保留；Activity 继续限制隐私，且失败不阻断业务 |
| 受管 profile 与 presets | `$DSH_HOME/profiles/clawdsh`、`$DSH_HOME/.agent-presets/{clawdsh,clawdsh-messaging-safe}` | 归安装器所有；修改过的 preset 需要显式执行先备份后重置 |
| OpenClaw runtime 与 state | `$DSH_HOME/clawdsh/channel/openclaw` | 只由 `channel install` 获取；保留既有配置与状态 |
| 兼容的受管 skills | `~/.clawdbot/skills` | 默认位于 `$DSH_HOME` 外；可设置 Skills Hub 的 `managedDir` 选择其他目录 |

如需完整运维备份，请先停止 ClawDSH，再为整个 `$DSH_HOME` 以及 `~/.clawdbot/skills` 或另行配置的外部 `managedDir` 创建快照。安装器生成的 source migration 与 preset 备份只覆盖点名的 profile／preset 资产，不能替代用户数据备份。只能在 ClawDSH 停止时恢复完整快照；请保留仅属主可访问的权限，并在启动前运行 `npx --yes @clawdsh/cli@next doctor`。

## 维护与故障排查

### 更新、诊断与迁移

```sh
npx --yes @clawdsh/cli@next
npx --yes @clawdsh/cli@next doctor
npx --yes @clawdsh/cli@next migrate source
npx --yes @clawdsh/cli@next migrate source --apply
npx --yes @clawdsh/cli@next migrate source --apply --backup-modified
npx --yes @clawdsh/cli@next channel install
npx --yes @clawdsh/cli@next channel doctor
```

再次运行 `next` 入口会安装当前候选版本，并执行幂等的托管升级。`doctor` 只检查安装器所有的 profile、bundle 与 preset；`channel doctor` 检查另行管理的 OpenClaw runtime。两条命令都不读取凭据存储。

`clawdsh migrate source` 是只读检查，会报告旧 source-linked 安装属于已知干净布局还是已知修改布局。`--apply` 会先备份已知干净布局再迁移；修改过的 source-owned patch、preset 或额外 profile entry 必须使用 `--apply --backup-modified`。未知、不完整、混合 checkout、非 symlink 或 package identity 不同的布局始终失败关闭。迁移会最后发布 `.clawdsh.json`，失败时自动回滚，且不会读取或移动 Settings、凭据、Memory、Sessions、Skills、Activity 或 OpenClaw state。

### 常见故障

| 现象 | 检查事项 |
|---|---|
| UI 能打开，但模型请求失败 | 配置 `DEEPSEEK_API_KEY`；启动过程有意保持无密钥，但模型调用需要密钥 |
| 语义 Memory 报告缺少 Ark key | 配置 `ARK_API_KEY`，或者只使用不带 Ark 语义召回的 Memory |
| `init` 拒绝已有 `clawdsh` profile | 运行错误信息打印的 `migrate source` 检查命令；未知且无标记的资产绝不会被接管 |
| 受管 preset 被修改 | 把修改另存，再使用 `clawdsh init --reset-preset` 创建带时间戳的备份并恢复受管 preset |
| `doctor` 报告中断的 transaction | 重新运行同一管理命令；后续工作前会先恢复，且不会把部分安装标记为已托管 |
| 端口被占用 | 使用 `--port <port>` 启动；Web flag 只接受 `--host`、`--port` 与可重复的 `--trusted-host` |
| Gateway 无法启用 | 运行 `channel install` 与 `channel doctor`，再完成 OpenClaw 自有账号和策略设置；只有 catalog 条目不构成支持证据 |

## 源码开发与项目政策

干净 checkout 使用隔离的源码开发 home，绝不使用公开安装的 `~/.dsh` home：

```sh
git clone https://github.com/Fatemoisted/ClawDSH.git
cd ClawDSH
pnpm install
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/run-clawdsh-dev.sh
```

`CLAWDSH_DEV_HOME` 默认为 `~/.clawdsh-dev`；源码包装脚本刷新开发链接后，把该路径导出为 `DSH_HOME`。私有开发 bundle 携带产品组合，而 profile 的 `cordis.patch.yml` 首次创建为空文件，后续刷新会逐字节保留。高级 Gateway 准备与源码生命周期详见[组装指南](packages/openclaw/preset-openclaw/README.md)。

- 支持与 bug 报告：[GitHub Issues](https://github.com/Fatemoisted/ClawDSH/issues)。
- 参与贡献：[CONTRIBUTING.md](CONTRIBUTING.md)。ClawDSH 自有改动遵循仓库的上游只读政策。
- 许可证：[MIT](LICENSE)，保留 DeepSeek Harness notice，并加入 ClawDSH contributors。
- 品牌：原创的[潮汐钳鲸资产与指南](packages/openclaw/preset-openclaw/brand/README.md)以鲸鱼为主体、珊瑚红小钳为附属，不复刻任何上游 Logo。

<!-- ════════════════ ClawDSH PUBLIC LANDING END ════════════════ -->

---

<!-- ⬇ 以下为上游 README 原文（勿改；rebase 冲突时以 upstream 为准） -->

# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
