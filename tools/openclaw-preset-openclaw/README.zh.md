# @clawdsh/dsh-preset-openclaw

[English](README.md) | 中文

**定位**：ClawDSH 的组装层——把 dsh 既有能力与 `packages/openclaw/*` 插件组合成"OpenClaw 形态"的个人助手。不改上游任何代码，只用 dsh 的 profile / bundle / preset / patch 机制叠加。

**OpenClaw 对应**：整体产品形态（gateway + 渠道 + soul + memory + automation 的默认组合）。

**接缝**：不是插件，是组装配置。本目录现在交付三样东西：
1. **agent preset**（`preset.yml` + `agent.cordis.yml`）——挂载 `@clawdsh/dsh-soul` 行，可被 dsh 的 agent-presets 发现机制发现（用户 preset 根目录为 `.agent-presets/`）；
2. **示例灵魂**（`souls/assistant.md`）；
3. **profile 模板**（`profile/`）——复制到 `$DSH_HOME/profiles/openclaw/` 即成为 `--profile openclaw` 的组装基座（bundles：`dsh-base`，常驻 daemon；不含 `dsh-headless`，那是一次性任务跑器）。

**规格**：docs/specs/roadmap.md（阶段 0/2 交付物） · **状态**：本地组装、e2e 与发布设施已验证；尚未实际执行 npm 发布

## 已验证组装

- ✅（阶段 0）soul 行在 agent 作用域内的挂载语义——由 `../../packages/openclaw/soul/tests/soul.spec.ts` 的 10 个契约测试覆盖；
- ✅（阶段 0）profile 解析与层叠机制——`DSH_HOME` 指向含本模板 profile 的目录后 `pnpm dsh --profile openclaw --dump-config` 可解析；
- ✅（阶段 2）渠道行接线——`profile/cordis.patch.yml` 已 `insert` `channel-core` + `channel-telegram` + `channel-feishu` 三条行；`channel-core` + `channel-feishu` 启用（飞书凭证走 env），`channel-telegram` 保持 `disabled: true`（无账号）；
- ✅（阶段 2）飞书真实 e2e——官方 SDK `LarkChannel` WebSocket 入站 → `channel-core` 持久 conversation/topic 回合 → DeepSeek 回复 → SDK 出站，用户已在飞书确认收到；
- ✅（阶段 2 补漏）memory 行接线——`profile/cordis.patch.yml` 已 `insert` `memory`（root 默认 `dshHomePath('memory')`）+ `embeddings-ark`（**已启用**：缺 ARK_API_KEY 时 boot 无感，只在 memory_search 调用时 fail-loud；key 放根 `.env` 或 `$DSH_HOME/.env`）；
- ✅（阶段 2 收尾）soul 文件路径随 preset 目录解析——相对 `source` 按挂载树 `ctx.baseUrl` 解析，`agent.cordis.yml` 已切 `source: ./souls/assistant.md`；
- ✅ Harness 原生渠道 Agent——`channel-core` 生成持久且不泄露平台 id 的 session id，经 `sessionPersistence` 恢复，并在创建/恢复两条路径都用 `dsh-agent-presets` 解析、挂载日志记录的 `openclaw` 组合；
- ✅ 飞书/Telegram 渠道行为——channel-core 提供持久、失败可传播的 `ctx.parallel` 路由，并在停机时排空已准入回合；结构化 command/mention、原生引用/topic、ack reaction、Unicode-safe 长回复分片、caption/富消息文本、Telegram 有界 API 重试与进程重启后会话连续性均有无密钥契约测试；
- ✅ Memory 写入与宿主编辑——模型侧额外写能力只有窄化的 `memory_append`，存储和 sandbox 围栏继续委托 Harness `ctx.fs`，不扩大普通文件或 shell 工具权限；宿主 watcher 只失效变化的索引条目，首次缺失的 root 在 append 前视为空，flush 周期归属在 memory 插件 remount 后仍可从日志恢复；
- ✅ symlink 过渡脚本化——`tools/link-openclaw.sh` 构建 9 个包，安装 profile 与 `.agent-presets/openclaw`，初始化 memory 目录，创建 9 个 `@clawdsh/*` 链接，并为仓库 checkout 桥接 Harness `dsh-agent-presets` 包；
- ✅ 独立私有 registry 发布线——9 个包共享 `clawdsh` family 版本/tag；同步 bump/verify/pack/publish、packed-install 验证与凭证隔离 workflow 均已实现，registry URL 只从受保护的 `npm-publish` environment 变量 `NPM_REGISTRY_URL` 读取（ADR-0004）；
- ⏳（阶段 3）headless 一次性任务形态挂 openclaw preset（飞书 daemon 已验证 preset+agent 组合；headless 的 preset 选择接线留阶段 3）；
- ⏳ 实际 npm 发布——当前工作树尚未有意发布任何 `@clawdsh/*` tarball，symlink 路径仍作为本地开发过渡。

## 使用（飞书 daemon，本地开发）

```bash
# 1. Build and refresh profile + agent preset + local package links
tools/link-openclaw.sh

# 2. 凭证走环境变量（不落盘；ARK_API_KEY 放根 .env 或 ~/.dsh/.env，永不入仓库）
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# 3. 起 daemon（常驻长连接，等飞书消息）
pnpm dsh --profile openclaw
```

`@clawdsh/*` 包发布到私有 registry 后（ADR-0004），上面的 symlink 步骤可选：用 `dsh plugin --profile openclaw add @clawdsh/dsh-<pkg>`（每包一条）声明式安装——这是用户路径；symlink 脚本仍是发布前开发路径。

未设 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 时配置校验会 fail-loud（`appId`/`appSecret` required）。启动后，SDK 的身份/连接失败会写入渠道日志；线上平台权限仍需带凭证部署验证。
