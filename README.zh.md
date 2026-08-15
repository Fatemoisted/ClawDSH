# ClawDSH

[English](README.md) | 中文

> **OpenClaw 的个人助手功能集，作为可组合插件重建在 DeepSeek Harness（`dsh`）的 Cordis 底盘之上。**

ClawDSH 保持 Harness 运行时不变，并增加独立归属的插件层。产品代码位于 [`packages/openclaw/`](packages/openclaw/README.md)，组装配置位于 [`tools/openclaw-preset-openclaw/`](tools/openclaw-preset-openclaw/README.md)，项目决策位于 `docs/{adr,specs,matrix,standards,journal}/`。上游 `vendor/`、`packages/*`（`openclaw/` 除外）、`apps/`、`website/` 及上游文档保持只读。

## 从源码 checkout 快速启动

环境要求为 Node.js 22.19 或更高的 22.x 版本，或 Node.js 24 及以上；仓库固定使用 pnpm 11.7.0。请在仓库根目录运行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run build
tools/link-openclaw.sh
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk_xxx
pnpm dsh --profile openclaw
```

安装后的 `openclaw` profile 是飞书渠道常驻 daemon，不是 Web UI 或一次性 headless runner。它使用 `$DSH_HOME`，默认值为 `~/.dsh`；`tools/link-openclaw.sh` 与 `pnpm dsh` 必须使用同一个 `DSH_HOME`。默认 profile 已安装但禁用了 Telegram、Discord 与 automation。链接脚本是发布前的开发路径，每次运行都会用当前 checkout 刷新已安装的 profile。如需在不向仓库写入 token 的前提下启用并验证 Telegram，请按 [Telegram 带凭证 e2e 实操手册](docs/cookbook/telegram-e2e.md)操作。

以下无密钥检查先验证 profile 组装且不连接飞书，再运行 ClawDSH 包测试：

```bash
FEISHU_APP_ID=cli-smoke FEISHU_APP_SECRET=smoke \
  pnpm dsh --profile openclaw --dump-config
pnpm run test:openclaw
```

`--dump-config` 只证明组合能够解析；平台权限、凭证和网络连通性仍需部署后的端到端检查。

## Telegram 真实客户端结论（2026-08-15）

本轮使用真实 Telegram Bot API 与客户端完成带凭证验证，已通过身份验证、私聊 `/start` 与精确回复、重启后的持久 Memory、群聊 mention/reply 门控、定向命令隔离、Harness `web_search`、离线补收、Unicode-safe 长回复分片、中断回合恢复，以及同一聊天 FIFO 投递。对于当时尚未接入图片导入的受测构建，本轮还实际观察到 caption 转发与无正文媒体忽略行为。

图片 materialization 与文本模型图片处理是在本轮之后加入，目前只有无密钥自动化覆盖，不属于带凭证真实客户端通过项。凭证热切换、chat-id 迁移、forum topic 与 ack reaction 也不在已记录的线上基线内。准确的证据边界见 [Telegram 带凭证 e2e 实操手册](docs/cookbook/telegram-e2e.md)与 [2026-08-15 日志](docs/journal/2026-08-15.md)。

## Harness 契约优先

日常 ClawDSH 开发从 Harness 约定和现有组件开始，不重新通读实现源码。阅读顺序如下：

| 需求 | 权威入口 |
|---|---|
| 运行时组合、轮次流程、会话与扩展点 | [Harness 架构](docs/architecture.md) |
| 完整包目录、依赖图与包组概览 | [Harness 模块入口](docs/matrix/harness-reuse.md#harness-module-entry) |
| 服务、事件与公开类型约定 | [子系统参考](docs/subsystems/README.md) |
| 依赖、能力、事件、工具与配置图 | [文档关系图索引](docs/graph-atlas.md) |
| 每个 ClawDSH 包如何复用 Harness | [Harness 复用地图](docs/matrix/harness-reuse.md) |
| ClawDSH 包配置与限制 | [自有包清单](packages/openclaw/README.md) |

开发只消费已记录的 `ctx.*` 服务、事件和公开类型，不导入或复制具体 Harness provider。仅在诊断内部 BUG、安全/并发/性能行为、未记录约定、缺失 seam 或上游破坏性变更时阅读所属源码；由此发现的缺失约定必须补入所属文档或 ADR。强制规则见[插件契约](docs/standards/plugin-contract.md)，决策理由见 [ADR-0006](docs/adr/0006-harness-contract-first.md)。

## 项目参考

- [项目目的与路线图](docs/specs/roadmap.md)
- [OpenClaw 功能对齐](docs/matrix/parity.md)
- [架构决策](docs/adr/)
- [开发规范](docs/standards/)
- [OpenClaw profile 与凭证](tools/openclaw-preset-openclaw/README.md)

## 开发检查

文档或包变更应在推送前运行范围最窄的所属检查：

```bash
pnpm run test:openclaw
pnpm exec tsc -p packages/openclaw/tsconfig.check.json
pnpm run doc-sync
pnpm run lint
```

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
