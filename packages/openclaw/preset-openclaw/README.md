# @clawdsh/dsh-preset-openclaw

**定位**：ClawDSH 的组装层——把 dsh 既有能力与 `packages/openclaw/*` 插件组合成"OpenClaw 形态"的个人助手。不改上游任何代码，只用 dsh 的 profile / bundle / preset / patch 机制叠加。

**OpenClaw 对应**：整体产品形态（gateway + 渠道 + soul + memory + automation 的默认组合）。

**接缝**：不是插件，是组装配置。本目录现在交付三样东西：
1. **agent preset**（`preset.yml` + `agent.cordis.yml`）——挂载 `@clawdsh/dsh-soul` 行，可被 dsh 的 agent-presets 发现机制发现（用户 preset 根目录为 `.agent-presets/`）；
2. **示例灵魂**（`souls/assistant.md`）；
3. **profile 模板**（`profile/`）——复制到 `$DSH_HOME/profiles/openclaw/` 即成为 `--profile openclaw` 的组装基座（bundles：dsh-base + dsh-headless）。

**规格**：docs/specs/roadmap.md（阶段 0/2 交付物） · **状态**：phase-2 channel-wired（profile 已 insert 三条渠道行；凭证真实 e2e 与 agent-spine preset 挂载待收尾）

## 阶段 0 已验证 / 阶段 2 待办

- ✅（阶段 0）soul 行在 agent 作用域内的挂载语义——由 `../soul/tests/soul.spec.ts` 的 10 个契约测试覆盖；
- ✅（阶段 0）profile 解析与层叠机制——`DSH_HOME` 指向含本模板 profile 的目录后 `pnpm dsh --profile openclaw --dump-config` 可解析；
- ✅（阶段 2）渠道行接线——`profile/cordis.patch.yml` 已 `insert` `channel-core` + `channel-telegram` + `channel-feishu` 三条行（默认 `disabled: true`，凭证后置）；`--dump-config` 冒烟可解析出三行（适配器 `inject 'channels'`，启用时须与 `channel-core` 同启）；
- ⏳（阶段 2）headless 形态下把 openclaw preset 挂到真实 agent（agent-spine-demo 目前不带 preset 选择，web 形态由 agent-presets 挂载；接线方案见 docs/specs/roadmap.md 阶段 2）；
- ⏳（阶段 2）`@clawdsh/*` 包从 profile 目录的解析（需 `dsh plugin --profile openclaw install` 或 workspace 链接）；
- ⏳（阶段 2）soul 文件路径随 preset 目录解析（当前相对 process.cwd()）。

## 使用（阶段 2 完成后）

```bash
mkdir -p ~/.dsh/profiles/openclaw && cp -R profile/* ~/.dsh/profiles/openclaw/
pnpm dsh --profile openclaw
```
