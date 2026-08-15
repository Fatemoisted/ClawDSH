# OpenClaw ↔ dsh 功能对齐矩阵

[English](parity.md) | 中文

> 本矩阵是 ClawDSH 的**单一事实源**：每个 OpenClaw 派生域或 ClawDSH 原生产品域都在这里得到唯一分类与状态。任何 PR 涉及功能变更必须同步更新本文件（见 `docs/standards/pr-policy.md`）。
>
> 复用、插件、新 seam 与暂缓继续构成 OpenClaw 派生域的四分类。「产品组装」是只用于 ClawDSH 原生产品面的独立分类。
>
> 分类含义：
> - **复用**：dsh 原生能力，直接用，不写代码；
> - **插件**：挂到 dsh 既有接缝上的增量包（`packages/openclaw/*`）；
> - **新 seam**：dsh 没有对应接缝，需要新增（必须有 ADR；除非 ADR 明确记录项目另行决策，否则 upstream-first）；
> - **产品组装**：基于 dsh 公开 API 的 ClawDSH 自有应用/profile 组合，不修改上游源码；
> - **暂缓**：本轮不做，记录原因。

## 基线（阶段 1 定稿，2026-08-14）

**OpenClaw 基线 = tag `v2026.1.5`（commit `197b8f7c3b`）**，选定依据（完整分析见 docs/journal/2026-08-14.md 阶段 1 节）：

| 指标 | 2025-12-31 | **v2026.1.5 ✅** | v2026.1.15 | v2026.1.20 | v2026.1.30 |
|---|---|---|---|---|---|
| 文件数 | 1197 | **1537** | 3367（翻倍） | 4041 | 4543 |
| 渠道 | discord/telegram | **+imessage/signal/slack** | +whatsapp | — | — |
| channels 抽象 | ✗ | ✗ | ✓ | ✓ | ✓ |
| memory 目录 | ✗ | ✗ | ✓ | ✓ | ✓ |
| bloat 迹象（extensions/plugins/docker 部署矩阵） | ✗ | **✗** | 出现 | 加剧 | 加剧 |

- **为何 v2026.1.5**：首个发布 tag（1.5-1/2/3 小版本只修 bug），"网关 + 5 渠道 + cron + sessions + tui/wizard" 的个人助手核心体验完整且稳定；所有 tag 中代码量最瘦（1537 文件 / 1.6MB）；无 bloat 迹象；时间 = 项目爆红高峰期。
- **功能补全参考**：whatsapp / memory / channels 抽象在基线中尚未出现 → 移植时查阅 `v2026.1.15`（`9c4c9c5edd`）；更早的 gateway 雏形参考 `2025-12-31`（`f03605d8ae`）。
- 参考仓库本地缓存：`/tmp/openclaw-ref`（partial clone，blob:none；机器重启后需重拉，命令见 journal）。

## 矩阵 v2（基线定稿）

| OpenClaw 或 ClawDSH 产品域 | 基线出处（v2026.1.5） | dsh 对应接缝 | 分类 | 落地包 | 状态 |
|---|---|---|---|---|---|
| 会话 / 消息历史 | `src/sessions/` | `ctx.sessions`（append-only log） | 复用 | — | 直接可用 |
| 会话追溯 / 回放 / 分叉 | —（dsh 原生） | Trajectory 视图 / replay | 复用 | — | 直接可用 |
| 工具执行（bash/文件/浏览器…） | `src/agents/*-tools.ts` | `ctx.tools` / `ctx.shell` / `ctx.fs` / `ctx.web` | 复用 | — | 直接可用 |
| 技能（Skill） | 顶层 `skills/` | `ctx.skills`（provider 合并） | 插件 | `skills-hub` | **implemented**（阶段 3 ✅） |
| 定时 / 自动化 | `src/cron/` | 自有 unref'd croner timer + `agent.followup`/`whenIdle`/`sessions.flush` 回合桥（`ctx.schedule` 否决：session-local + 300s 下限 + 仅工具面 API） | 插件 | `automation` | **implemented，存在已知限制**（[包详情](../../packages/openclaw/automation/README.md#known-limitations-and-deferred-work)） |
| 人格（Soul） | `src/agents/system-prompt.ts` 首行 + workspace 六文件（AGENTS/SOUL/TOOLS/IDENTITY/USER/BOOTSTRAP.md） | system-prompt 装配（persona 首行 / soul append / complete 段 / 工具指引带）+ 渠道呈现（IDENTITY ✅） | 插件 | `soul` | **implemented**（阶段 0 ✅ + 阶段 2 深读定稿 ✅） |
| 记忆（Memory） | 基线无 → 参考 v2026.1.15 `src/memory/` + `src/agents/memory-search.ts`、`memory-tool.ts` | Harness `ctx.fs`/sandbox + tools/system prompt + embeddings | 插件 | `memory` + `embeddings` + `embeddings-ark` | **implemented**（三工具、配置默认、缺失 root 启动、持久 flush 周期 ✅） |
| **渠道网关（Gateway）** | `src/gateway/` | **无** | **新 seam** | `channel-core` | **implemented**（可等待持久化、确定性恢复/preset/FIFO、legacy thread-only 兼容、`groupMode`/结构化 mention 策略、准确模型图片模态检查与持久 Harness attachment 引用 ✅） |
| 渠道：Telegram | `src/telegram/` | `ctx.channels` | 插件 | `channel-telegram` | **已实现，带凭证的私聊/群聊文本/caption e2e 已验证**（photo/图片 document 导入与文本模型不下载行为已通过无密钥测试，但未线上验证；forum topic 真实覆盖仍推迟；[包详情](../../packages/openclaw/channel-telegram/README.md)） |
| 渠道：Discord | `src/discord/` | `ctx.channels` | 插件 | `channel-discord` | **implemented**（Harness credentials/timer、私信/服务器/thread 归一化、mention 门控、原生引用/reaction、安全 2000-unit 分片、先排空再销毁的生命周期 ✅；带凭证线上 e2e 待完成） |
| 渠道：iMessage / Signal / Slack | `src/imessage/` 等 | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 渠道：WhatsApp | 参考 v2026.1.15 `src/whatsapp/` | `ctx.channels` | 插件 | 后续逐包 | 暂缓（阶段 3） |
| 审批 / 安全策略 | `src/security/`（1.15 起） | `ctx.approval` / guard | 复用（配置） | — | 直接可用 |
| 联邦节点（clawd） | 基线早期无 | `ctx.subagents`（transport） | 插件 | `clawd-federation` | ADR-0005（仅评估），实现暂缓 |
| 智能家居（casa） | 基线无 | 无 | 新插件域 | 待命名 | 暂缓 |
| 本地浏览器对话 | `ui/`（+ `apps/`） | `dsh-web-app` + `clawdsh` preset（`ClawDSH 模式`） | 复用（profile/preset） | `tools/openclaw-preset-openclaw` + `dsh-web-app` | **implemented 基线**（阶段 4；干净安装关闭飞书/Telegram/Discord/Automation） |
| ClawDSH 产品壳、Settings 与语义 Activity | —（ClawDSH 原生） | 公开 dsh Web 组装 + Settings/Credentials/Session history；无 Client Slot | 产品组装 | `tools/openclaw-preset-openclaw` | [ADR-0007](../adr/0007-clawdsh-local-gui-product.md) 已接受；实现待完成 |

## 国内平台（原则：OpenClaw 上游有的才实现）

> **项目原则（发起人 2026-08-14 确立）**：只实现 OpenClaw 上游有出处的功能，摸着石头过河；不自行发明上游没有的功能域。国内平台按此原则逐一核实：

| 平台 | OpenClaw 上游现状 | 判定 |
|---|---|---|
| **飞书（Lark）** | ✅ 官方 `extensions/feishu`（2026-02-03 引入：`2483f26c23`→`0223416c61`；v2026.2.12 起发布） | **做，且为发起人第一优先**（详见下方矩阵行） |
| 企业微信 / 微信 / 公众号 / 个人微信 | ❌ 上游（最新 main）无任何微信系渠道（`tencent` 扩展是腾讯云 LLM provider，非渠道） | **不做核心包**——原则性排除；上游将来新增 wecom 时再跟进 |
| 钉钉 / QQ | ❌ 上游无 | 不做——原则性排除，同上 |

### 飞书渠道（矩阵行）

| 功能域 | 出处 | dsh 接缝 | 分类 | 落地包 | 状态 |
|---|---|---|---|---|---|
| 渠道：飞书（Lark） | OpenClaw `extensions/feishu`（v2026.2.12 起；引入提交 `0223416c61`） | `ctx.channels` + 官方 SDK 1.73 `LarkChannel` | 插件 | `channel-feishu` | **implemented，仍有集成工作**（[包详情](../../packages/openclaw/channel-feishu/README.md#known-limitations-and-deferred-work)） |

微信系不落矩阵（不实现），决策记录见 `docs/specs/feature-channel-wechat.md`。

## 分发状态（不属于功能对齐）

10 个 `packages/openclaw/*` 成员现已组成独立、共享版本的 `clawdsh` release family，使用 `clawdsh-v*` tag。同步 bump/verify/pack/publish、workspace 约束、pack 产物、主路径与 invariant 路径的全新 packed-install 验证及受保护的私有 registry `.github/workflows/clawdsh-publish.yml` 路径均已实现。当前工作树尚未执行 ClawDSH npm 发布；本地 profile 组装仍使用 `tools/link-clawdsh.sh` symlink。

## 维护规则

1. 新增/删除/重新分类任何功能域 = 改本表 + 提交说明里注明；
2. "暂缓"条目必须写原因与解除条件；
3. 每次 dsh 上游同步后复查本表（OpenClaw 基线是功能清单快照，不再变动；若需深读某一功能，按"基线出处"列查 `/tmp/openclaw-ref`）；
4. 没有上游出处的 OpenClaw 功能域不落矩阵（原则性排除），决策记录在对应包 README 或 journal；ClawDSH 原生产品面是显式例外，并使用「产品组装」分类。
