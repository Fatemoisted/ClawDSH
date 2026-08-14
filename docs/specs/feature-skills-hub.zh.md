# 功能规格：Skills hub（ClawHub 兼容技能加载）

[English](feature-skills-hub.md) | 中文

- **状态**：implemented（阶段 3 ✅，2026-08-14）
- **实现包**：`packages/openclaw/skills-hub`（`@clawdsh/dsh-skills-hub`）
- **OpenClaw 对应**：Skills / ClawHub（v2026.1.5 顶层 `skills/` + `src/agents/skills.ts` + `docs/skills.md`）：每目录 `SKILL.md` 声明、AgentSkills-compatible frontmatter、`metadata.clawdbot` gating、正文从不内联进 prompt。
- **决策记录**：Agent Note [2026-08-14-openclaw-skills-domain-mapping](../../.agents/notes/implemented/architecture/2026-08-14-openclaw-skills-domain-mapping.md)

## 目标

- 把 OpenClaw 生态技能直接加载为 dsh 技能：workspace `skills/` 目录、legacy `~/.clawdbot/skills` 目录或配置的附加目录下，一个目录一个 `SKILL.md`；
- 在目录构建时求值 `metadata.clawdbot.requires.{bins,anyBins,env}`，排除被 gating 挡掉的技能；
- `metadata` 接受 record 或 OpenClaw 所写的单行 JSON 字符串；
- 端到端复用既有技能接缝：registry 合并、模型目录、按名加载、注销。

## 非目标

- 无 ClawHub 安装执行（`metadata.clawdbot.install` 规格被忽略）——baseline 经外部 CLI 分发，运行安装器是全新表面；
- 无远程 ClawHub 注册表（拉取、版本锁定、回滚）——v2026.1.5 无进程内注册表；
- 无 hub 目录的 fs watcher——变更在下一次目录收集时生效；
- 不移植 OpenClaw 的快照 prompt 注入（路径进系统提示）——dsh 的 `tool-skill` 目录 + 按名加载是模型契约，且严格更强；
- 不移植 OpenClaw 的 config 驱动门（`requires.config`、`os`）——PATH/env 门覆盖本批次范围。

## 接缝（成文）

- `ctx.skills`（声明 inject）：一个 `SkillProvider`（`name: 'clawhub'`）经 `registerProvider` 注册；registry 负责与其他 provider 合并、重名裁决（最近层 → rank → 注册序）、缓存失效与注销；
- rank 契约：workspace `<cwd>/skills` = 300（custom 槽位：低于 dsh 原生项目目录、高于用户目录），附加目录 = 350，managed `~/.clawdbot/skills` = 450（低于 dsh 原生用户目录）；
- 模型表面：无新工具、无新事件——`tool-skill` 发布合并后的目录并按名加载正文；日志不变式经既有路径成立。

## 配置面

```yaml
skills-hub:
  workspaceDir: /abs/path   # 固定 workspace 技能目录；缺省按 lookup cwd 扫 <cwd>/skills
  managedDir: /abs/path     # 缺省 ~/.clawdbot/skills（legacy OpenClaw 目录）
  extraDirs: [/abs/path]    # 附加目录，rank 350
  gating: true              # 求值 metadata.clawdbot.requires.{bins,anyBins,env}
```

## 验收标准

1. ✅ workspace `skills/<name>/SKILL.md` 以 workspace rank 与 source 列为 dsh 技能，非法文件（缺 name/description、无 `SKILL.md`）被跳过（测试：`lists SKILL.md directory skills from the workspace root and skips invalid files`）；
2. ✅ 重名按 rank 裁决：workspace（300）胜 managed（450）；同 rank 的 dsh 原生 custom 目录经注册序胜 hub 候选（测试：`resolves a duplicate name by rank`、`lets a same-rank skill-filesystem custom dir beat the hub workspace candidate`）；
3. ✅ `metadata.clawdbot` gating 排除缺 bins/env 的技能，`anyBins` 有一个 bin 存在即通过，`gating: false` 全部列出（测试：`evaluates metadata.clawdbot gating`、`passes an anyBins gate`）；
4. ✅ 单行 JSON metadata 归一化进候选与加载后的定义；定义加载后无 frontmatter 且保留 dsh invocation-policy 键（测试：`normalizes single-line JSON metadata`、`keeps the dsh invocation-policy keys`）；
5. ✅ 注册可逆：dispose 插件 fiber 即注销 provider（测试：`unregisters the provider when the plugin fiber is disposed`）。
