# @clawdsh/dsh-skills-hub

[English](README.md) | 中文

**定位**：ClawHub 兼容的技能加载——让 OpenClaw 生态已有的 Skill（一个目录一个 `SKILL.md`，AgentSkills-compatible YAML frontmatter）直接作为 dsh 技能被加载。是 `ctx.skills` 上的一个薄 `SkillProvider`：只补 OpenClaw 的源目录惯例（workspace `skills/`、legacy `~/.clawdbot/skills`、附加目录）与 `metadata.clawdbot.requires.*` gating；其余——发现合并、重名裁决、缓存失效、注销、模型表面——全部由 dsh 技能接缝已有。

**OpenClaw 对应**：Skills（v2026.1.5 顶层 `skills/` + `src/agents/skills.ts` + `docs/skills.md`）。对齐其形态：`name` + `description` 必需 frontmatter、正文从不内联进 prompt、gating 在目录构建时求值、`metadata` 接受 record 或 OpenClaw 所写的单行 JSON 字符串。不移植：安装执行（`install: [{kind: brew/node/go/uv, …}]`）与外部 ClawHub CLI——v2026.1.5 本身没有进程内注册表。

**接缝**（全部既有，无新增）：
- `ctx.skills`（声明 inject）：provider 经 `registerProvider` 注册；registry 负责与其他 provider 合并、重名裁决（最近层 → rank → 注册序）、注销与缓存失效；
- `ctx.subprocess`（声明 inject）：由其执行环境 resolver 负责 PATH 查找，包括 Windows `PATHEXT` 与环境变量名大小写不敏感语义；skills-hub 只把解析成功映射为 gate 结果；
- 模型表面：`tool-skill` 发布目录条目并按名加载正文——无新工具、无新事件。「model-visible means logged」经既有路径（目录注入与工具结果）成立。

**规格**：docs/specs/feature-skills-hub.md · **状态**：implemented（阶段 3 ✅）

## 用法

```yaml
- id: skills-hub
  name: '@clawdsh/dsh-skills-hub'
  config:
    enabled: true                 # false registers no provider
    # workspaceDir: /abs/path      # 固定 workspace 技能目录；缺省按 lookup cwd 扫 <cwd>/skills
    # managedDir: /abs/path        # 缺省 ~/.clawdbot/skills（legacy OpenClaw 目录）
    # extraDirs: [/abs/path]       # 附加目录，rank 350
    # gating: true                 # 求值 metadata.clawdbot.requires.{bins,anyBins,env}
```

`clawdsh-skills-hub` 设置 namespace 在重启时生效。启动快照为关闭时不会触碰 `ctx.skills`；修改持久化值后也要等重启才会新增 provider，因此任何 ClawHub 根在关闭期间都不会参与目录收集。

## 设计说明

- **为何是薄 provider 而非重写**：技能注册表已拥有分层合并、层内 rank 排序、注册注销、目录缓存与模型面目录/加载工具。skills-hub 只贡献 OpenClaw 源惯例与 gating（见 [skills-domain mapping Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-openclaw-skills-domain-mapping.md)）；
- **rank 契约**：workspace `<cwd>/skills` = 300（custom 槽位：低于 dsh 原生项目目录、高于用户目录），附加目录 = 350，managed `~/.clawdbot/skills` = 450（低于 dsh 原生用户目录：原生目录优先于 legacy clawdbot 目录）；同 rank 平手按 provider 注册序裁决；
- **list 时 gating**：`requires.bins`（全部在 PATH）、`requires.anyBins`（至少一个）、`requires.env`（环境变量已设置）；被排除的技能不进目录；bins 通过 Harness 执行环境 resolver 解析，不启动它们；
- **仅目录 + SKILL.md**：与 OpenClaw 惯例一致；无 `SKILL.md` 的目录不是技能，根目录缺失即零技能（OpenClaw 式静默跳过），非法文件 warn 跳过；
- **无安装执行、无远程注册表**：OpenClaw baseline 经外部 CLI 分发 ClawHub 技能；本包只加载已在磁盘上的。
- **Provider 级关闭**：`enabled: false` 不注册 provider，因此任何 ClawHub 根都不会参与目录收集。

## 变更日志

- 0.1.0：首个版本（workspace/managed/extra 三根、`metadata.clawdbot` gating、JSON 字符串 metadata 归一化；11 个契约测试，keyless）。

## Model Experience

### 技能目录条目

#### What the model sees

每个列出的技能贡献一行目录条目——name、description 与路由指引——由 `tool-skill` 消费者渲染；正文仅在模型调用 `skill` 工具时加载，从不内联。

#### Token effect

每技能一行目录条目，与磁盘上通过 gating 的技能数量成正比。

#### KV Cache effect

目录条目位于注入的目录块内；增删改技能会改变该块，技能集不变时保持可复用。

## Known Limitations and Deferred Work

- **无 ClawHub 安装执行**：`metadata.clawdbot.install` 规格（brew/node/go/uv）被忽略；技能必须已存在于扫描目录中；
- **无远程 ClawHub 注册表**：无拉取、版本锁定或回滚（baseline 经外部 CLI 分发；注册表客户端是全新表面）；
- **无 fs watcher**：变更在下一次目录收集时生效（`skills/change` 失效覆盖其他 provider 的变更；本目录的 watcher 延后）；
- **gating 范围**：bin gate 经 `ctx.subprocess` 解析（包括 Windows `PATHEXT`）；OpenClaw 的 config 驱动门（`requires.config`、`os`）未移植；
- **`~/.clawdbot/skills` 是默认 managed 根**：存量 OpenClaw 安装开箱即用；如需指向别处，配置 `managedDir`。
