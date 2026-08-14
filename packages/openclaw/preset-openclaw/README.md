# @clawdsh/dsh-preset-openclaw

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
- ⏳（阶段 2）headless 形态下把 openclaw preset 挂到真实 agent（agent-spine-demo 目前不带 preset 选择，web 形态由 agent-presets 挂载；接线方案见 docs/specs/roadmap.md 阶段 2）；
- ⏳（阶段 2）`@clawdsh/*` 包从 profile 目录的解析（包未发布，暂用 `$DSH_HOME/profiles/node_modules/@clawdsh/` 手动 symlink 过渡）；
- ⏳（阶段 2）soul 文件路径随 preset 目录解析（当前相对 process.cwd()）。

## 使用（飞书 daemon，本地开发）

包未发布到 npm 前，`@clawdsh/*` 不被 profile 的依赖闭包解析，需先建 symlink 过渡：

```bash
# 1. 复制 profile 模板
mkdir -p ~/.dsh/profiles/openclaw
cp -R packages/openclaw/preset-openclaw/profile/* ~/.dsh/profiles/openclaw/

# 2. @clawdsh 包解析（包发布前的过渡；healProfilesModuleFallback 只 BFS apps/cli 依赖闭包）
mkdir -p ~/.dsh/profiles/node_modules/@clawdsh
ln -sfn "$PWD/packages/openclaw/channel-core" ~/.dsh/profiles/node_modules/@clawdsh/dsh-channel-core
ln -sfn "$PWD/packages/openclaw/channel-feishu" ~/.dsh/profiles/node_modules/@clawdsh/dsh-channel-feishu
ln -sfn "$PWD/packages/openclaw/channel-telegram" ~/.dsh/profiles/node_modules/@clawdsh/dsh-channel-telegram

# 3. 凭证走环境变量（不落盘）
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export DEEPSEEK_API_KEY=sk-xxx

# 4. 起 daemon（常驻长连接，等飞书消息）
pnpm dsh --profile openclaw
```

未设 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 时 boot 会 fail-loud（`appId`/`appSecret` required），不会静默收不到消息。
