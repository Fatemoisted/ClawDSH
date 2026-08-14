# @clawdsh/dsh-preset-openclaw

[English](README.md) | 中文

**定位**：ClawDSH 的组装层——把 dsh 既有能力与 `packages/openclaw/*` 插件组合成"OpenClaw 形态"的个人助手。不改上游任何代码，只用 dsh 的 profile / bundle / preset / patch 机制叠加。

**OpenClaw 对应**：整体产品形态（gateway + 渠道 + soul + memory + automation 的默认组合）。

**接缝**：不是插件，是组装配置。本目录现在交付三样东西：
1. **agent preset**（`preset.yml` + `agent.cordis.yml`）——挂载 `@clawdsh/dsh-soul` 行，可被 dsh 的 agent-presets 发现机制发现（用户 preset 根目录为 `.agent-presets/`）；
2. **示例灵魂**（`souls/assistant.md`）；
3. **profile 模板**（`profile/`）——复制到 `$DSH_HOME/profiles/openclaw/` 即成为 `--profile openclaw` 的组装基座（bundles：`dsh-base`，常驻 daemon；不含 `dsh-headless`，那是一次性任务跑器）。

**规格**：docs/specs/roadmap.md（阶段 0/2 交付物） · **状态**：phase-2 e2e-verified（飞书消息 → 人格化 agent → 回复，真实闭环已验证）

## 阶段 0 已验证 / 阶段 2 待办

- ✅（阶段 0）soul 行在 agent 作用域内的挂载语义——由 `../soul/tests/soul.spec.ts` 的 10 个契约测试覆盖；
- ✅（阶段 0）profile 解析与层叠机制——`DSH_HOME` 指向含本模板 profile 的目录后 `pnpm dsh --profile openclaw --dump-config` 可解析；
- ✅（阶段 2）渠道行接线——`profile/cordis.patch.yml` 已 `insert` `channel-core` + `channel-telegram` + `channel-feishu` 三条行；`channel-core` + `channel-feishu` 启用（飞书凭证走 env），`channel-telegram` 保持 `disabled: true`（无账号）；
- ✅（阶段 2）飞书真实 e2e——`channel-feishu`（长连接入站）→ `channel-core`（per-thread agent turn）→ DeepSeek agent 回复 → `im.message.create` 出站，用户已在飞书确认收到；
- ✅（阶段 2 补漏）memory 行接线——`profile/cordis.patch.yml` 已 `insert` `memory`（root 默认 `dshHomePath('memory')`）+ `embeddings-ark`（**已启用**：缺 ARK_API_KEY 时 boot 无感，只在 memory_search 调用时 fail-loud；key 放根 `.env` 或 `$DSH_HOME/.env`）；
- ✅（阶段 2 收尾）soul 文件路径随 preset 目录解析——相对 `source` 按挂载树 `ctx.baseUrl` 解析，`agent.cordis.yml` 已切 `source: ./souls/assistant.md`；
- ✅（阶段 2 收尾）symlink 过渡脚本化——`tools/link-openclaw.sh` 一键复制 profile + 建 9 个 `@clawdsh/*` symlink（替代手动四步）；
- ⏳（阶段 3）headless 一次性任务形态挂 openclaw preset（飞书 daemon 已验证 preset+agent 组合；headless 的 preset 选择接线留阶段 3）；
- ✅（阶段 3）`@clawdsh/*` 发布面（ADR-0004）：私有 registry manifest + `clawdsh-publish` 工作流；首次实际发布待 registry URL（symlink 保留为开发过渡）。

## 使用（飞书 daemon，本地开发）

```bash
# 1. 安装/刷新 profile + @clawdsh symlink 过渡（幂等）
tools/link-openclaw.sh

# 2. 凭证走环境变量（不落盘；ARK_API_KEY 放根 .env 或 ~/.dsh/.env，永不入仓库）
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# 3. 起 daemon（常驻长连接，等飞书消息）
pnpm dsh --profile openclaw
```

`@clawdsh/*` 包发布到私有 registry 后（ADR-0004），上面的 symlink 步骤可选：用 `dsh plugin --profile openclaw add @clawdsh/dsh-<pkg>`（每包一条）声明式安装——这是用户路径；symlink 脚本仍是发布前开发路径。

未设 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 时 boot 会 fail-loud（`appId`/`appSecret` required），不会静默收不到消息。
