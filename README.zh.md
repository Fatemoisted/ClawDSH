# ClawDSH

[English](README.md) | 中文

> **OpenClaw 的个人助手能力，作为可组合插件重建在 DeepSeek Harness（`dsh`）的 Cordis 底盘之上。**

ClawDSH 保持 Harness runtime 不变，并增加独立归属的插件层。产品代码位于 [`packages/openclaw/`](packages/openclaw/README.md)，组装配置位于 [`packages/openclaw/preset-openclaw/`](packages/openclaw/preset-openclaw/README.md)，项目决策位于 `docs/{adr,specs,matrix,standards,journal}/`。上游自有 source 保持只读。

## 从源码 checkout 快速启动

使用 Node.js 22.19 或更高的 22.x 版本，或 Node.js 24 及以上。仓库固定使用 pnpm 11.7.0。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
pnpm --dir packages/openclaw/preset-openclaw/product-shell install --frozen-lockfile
pnpm --dir packages/openclaw/preset-openclaw/product-shell run build
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

该 profile 在 `/clawdsh/` 提供 ClawDSH 产品壳，并把 `/` 下的原生 dsh Web 保留为 Harness 高级；两者共享同一个 Host、Session store 与 Connection transport。新 Session 默认使用显示为 `ClawDSH 模式` 的 `clawdsh` preset。Link script 与 `dsh` 必须使用同一个 `DSH_HOME`。Memory 与 Skills 可用；Automation、canonical OpenClaw 通信 sidecar 与保留的 legacy-channel group 在干净安装中都默认关闭。只有对话发起模型请求时才需要模型凭据。

```bash
pnpm dsh --profile clawdsh --dump-config
pnpm run test:openclaw
```

`--dump-config` 只证明组合能够解析；平台权限、凭据与网络投递仍需范围明确的端到端检查。

## 渠道状态：sidecar 是 canonical，但默认关闭且未经认证

[ADR-0008](docs/adr/0008-openclaw-channel-plane.md) 把锁定的 OpenClaw Gateway sidecar 确立为通信平面 owner。Production catalog 记录 27 种传输（**24+3**），但 catalog 存在不等于 runtime 支持：所有 sidecar Channel 仍为 `cataloged`、默认关闭，且既不是 `certified` 也不是 `enabled`。组装与认证遵循[渠道同步规范](docs/standards/openclaw-channel-sync.md)。

进程内 Telegram、Discord 与飞书 adapter 只保留在单独且默认关闭的 `clawdsh-legacy-channel-plane` compatibility group 中。若存在 legacy opt-in，Gateway 启动与 Settings preflight 会拒绝启用 canonical sidecar；两条路径绝不能使用同一平台账号。

历史带凭证证据明确只属于 legacy path：飞书文本在 2026-08-14 完成真实 round trip；Telegram 在 2026-08-15 完成真实 Bot API/client 私聊与群聊文本/caption、Harness `web_search`、重启/恢复、离线补收、Unicode 分片与同一 chat FIFO 检查。Discord 有无密钥覆盖，但没有真实服务器 E2E。这些结果不能认证 sidecar。详见 [Telegram legacy E2E 手册](docs/cookbook/telegram-e2e.md)与[证据日志](docs/journal/2026-08-15.md)。

## Harness 约定优先

日常 ClawDSH 开发从 Harness 约定与现有组件开始，不重新通读实现源码：

| 需求 | 权威入口 |
|---|---|
| Runtime 组合、回合流程、Session 与扩展点 | [Harness 架构](docs/architecture.md) |
| 完整 package inventory 与依赖图 | [Harness 模块入口](docs/matrix/harness-reuse.md#harness-module-entry) |
| Service、event 与 public type | [子系统参考](docs/subsystems/README.md) |
| Capability、event、tool、配置与 lifecycle graph | [文档关系图索引](docs/graph-atlas.md) |
| 每个 ClawDSH package 如何复用 Harness | [Harness 复用地图](docs/matrix/harness-reuse.md) |

开发只消费已记录的 `ctx.*` service、event 与 public type，不导入或复制具体 Harness provider。仅在诊断内部 BUG、安全/并发/性能 behavior、未记录约定、缺失 seam 或上游破坏性变更时阅读所属源码。强制规则见[插件约定](docs/standards/plugin-contract.md)，决策理由见 [ADR-0010](docs/adr/0010-harness-contract-first.md)。

项目参考：[路线图](docs/specs/roadmap.md) · [状态矩阵](docs/matrix/parity.md) · [架构决策](docs/adr/) · [开发规范](docs/standards/)

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
