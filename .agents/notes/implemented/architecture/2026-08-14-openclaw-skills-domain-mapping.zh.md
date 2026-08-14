# Agent Note: OpenClaw skills 功能域 → dsh skills-hub 映射

Status: implemented

[English](2026-08-14-openclaw-skills-domain-mapping.md) | 中文

## 问题

对齐矩阵的 Skills 行（出处：OpenClaw 顶层 `skills/`，接缝：`ctx.skills` provider 合并）处于 planning。dsh 已自带完整技能接缝——`SkillRegistry`（分层 provider 合并）、`skill-filesystem`（SKILL.md + YAML frontmatter 发现）、`tool-skill`（模型面目录发布 + 按名加载）。skills-hub 包要回答的问题：在这个接缝之上，真正的增量是什么？OpenClaw/ClawHub 格式与 dsh 已解析的格式差异具体在哪？

## 决策

深读 OpenClaw `v2026.1.5`（`197b8f7c3b`）后定论：**skills-hub 是注册在 `ctx.skills` 上的一个薄 `SkillProvider`——仅此而已**。无新接缝、无新工具、不重写发现逻辑。

OpenClaw 侧（顶层 `skills/`、`src/agents/skills.ts`、`docs/skills.md`）：

- **声明**：45 个内置技能，每目录一个 `SKILL.md`；"AgentSkills-compatible" YAML frontmatter，必需 `name` + `description`，可选 `homepage`，可选 `metadata`——单行 JSON 字符串，其 `clawdbot` 键承载 gating（`requires.bins` / `requires.anyBins` / `requires.env`）与安装规格。正文自由 markdown。
- **模型访问**：此 tag 无按名加载工具。每会话快照只把每个技能的 name、description、绝对路径注入 prompt；模型自己用文件系统工具读正文。gating（`requires.*`、config、os）在快照构建时一次性求值。
- **发现优先级**：`extraDirs < bundled < managed（~/.clawdbot/skills）< workspace（<workspaceDir>/skills）`。
- **ClawHub 分发**：此 tag 无进程内注册表或远程拉取——外部 npm CLI（`clawdhub search/install/update/publish`）包成 bundled skill，安装执行（brew/node/go/uv）在 `skills-install.ts`。

dsh 侧映射：

| OpenClaw skills 组成部分 | dsh 对应落地 |
|---|---|
| 每目录 `SKILL.md` 声明 | 已覆盖：`skill-filesystem` 发现解析同形态（name/description 必需、`isSkillName` 校验） |
| prompt 里只有 name + description + 路径，正文从不内联 | 已覆盖且更强：`tool-skill` 每 pre-step 发布 digest 去重的 `<available_skills>` 目录，并经 `skill` 工具按名加载正文——正文同样从不内联 |
| workspace `<cwd>/skills` 目录 | skills-hub 按 lookup 扫描 `<cwd>/skills`，rank 300（`custom` 槽位：低于 dsh 原生项目目录、高于用户目录） |
| managed `~/.clawdbot/skills` 目录 | skills-hub 默认扫描，rank 450（低于 dsh 原生 user 目录 400：原生目录优先于 legacy clawdbot 目录） |
| config 里的 extra 目录 | skills-hub `extraDirs`，rank 350 |
| `metadata` 单行 JSON 字符串 | skills-hub 把 record **或** JSON 字符串归一化为解析后的 record（skill-filesystem 的解析器忽略字符串 metadata） |
| 快照构建时 gating（`requires.bins/anyBins/env`） | skills-hub 在 `list()` 时求值 `metadata.clawdbot.requires.*`——bins 在 PATH 上探测、env 对照 `process.env`；被 gating 排除的技能不进目录 |
| 安装规格（`install: [{kind: brew/node/go/uv, …}]`） | 本批次不移植——无安装执行、无 ClawHub CLI 调用；记为 Known Limitation |
| bundled skills 目录 | 不适用——dsh 自带 bundled skills（`skill-badge`） |
| 每会话快照缓存 | 不需要——registry 按 cwd/provider 缓存已收集目录，`skills/change` 时失效 |

为何是 provider 而非重写：技能接缝已拥有发现合并、重名裁决（最近层胜 → rank → 注册序）、缓存失效、注销、以及全部模型表面。在 skills-hub 里重建任何一块都违反复用铁律，且与 registry 的保证重复。

## 考虑过的替代方案

**移植 OpenClaw 的快照 prompt 注入（路径进系统提示）。** 否决：dsh 的技能模型契约是 `tool-skill` 目录 + 按名加载工具，正文已不进 prompt 且严格强于路径罗列；重复注入路径只会污染 prompt。

**ClawHub 注册表客户端（远程拉取、版本锁定、回滚）。** 本批次否决：`v2026.1.5` 本身没有进程内注册表——分发靠外部 CLI。本地目录加载即此 tag 的完整功能；远程注册表是 baseline 从未有过的表面。

**独立发现接缝（`ctx.skillsHub`）。** 否决：增量只是既有接缝上的一个 provider；新服务不承载任何 registry 未提供的能力。

**直接 import `skill-filesystem` 的解析器复用。** 否决：跨包导入具体实现被禁止；provider 契约（`SkillProvider`/`SkillCandidate`/`SkillDefinition`）是唯一共享表面。本地解析器刻意保持小（frontmatter + metadata 归一化 + gating），使用同一 `yaml` 依赖。

## 影响

- skills-hub 挂 host 面，openclaw preset 默认启用：纯增量目录合并，目录不存在即空列表、无凭证、无安装执行——存量 OpenClaw 用户的 `~/.clawdbot/skills` 开箱即用。
- rank 选择是契约：300（workspace）/ 350（extra）/ 450（managed）落在 dsh 原生项目（100–200）与用户（400–500）槽位之间；同 rank 平手按 provider 注册序裁决，故 skill-filesystem 赢 300 平手。
- gating 尽力而为（PATH 探测，不起子进程）；对齐规格将其记为限制而非保证。
- 安装执行与未来可能的 ClawHub 远程注册表回到本 Note 重新论证，而非默认补结构。
