# Feature spec：GUI 前台（dsh-web-app + openclaw preset）

[English](feature-gui-web.md) | 中文

- **状态**：implemented（阶段 4 ✅，2026-08-15）
- **实现**：`packages/openclaw/preset-openclaw/`（组装，非插件）
- **OpenClaw 对应**：第二种用法——与渠道前台并列的本地 GUI 控制台

## 目标

- `pnpm dsh --profile openclaw` 在 `http://127.0.0.1:3080` 起浏览器 GUI，承载 OpenClaw 功能；
- GUI 对话呈现与渠道路径相同的 soul 人格、memory 召回/工具、skills 目录；
- 新 GUI 会话默认挂「OpenClaw 形态」agent preset。

## 非目标

- 不写 ClawDSH 自有 GUI 代码——整体复用 dsh 的 `dsh-web-app` bundle；
- 不改渠道（飞书/Telegram）前台路径；
- 逐会话 preset 选择仍保留——只设默认。

## 组装

- `profile/package.json` — `dsh.profile.bundles` = `[dsh-base, dsh-web-app]`；
- `profile/cordis.patch.yml` — 覆盖 `agent-presets.default` → `openclaw`；
- `agent.cordis.yml` — 镜像 `standard` 预设全套工具，`soul` 替换 `persona`；
- `tools/link-openclaw.sh` — 把 preset 装进 `$DSH_HOME/.agent-presets/openclaw/`。

## 模型可见面

- persona = host `system-prompt`「personal AI assistant」+ `soul` 段（`mode: append`）；
- memory 召回段 + `memory_search` / `memory_get`（host plane）；
- skills 目录经 `tool-skill` + `skill-filesystem`；
- 全套 `standard` 工具（shell、fs、web、plan、subagents、workflow）。

## 验收标准

1. GUI 能起并回复消息（agent 循环在跑）；
2. 新会话默认 preset 是「OpenClaw 形态」；
3. 组装后的 prompt 无「coding agent」泄漏（否则把 `soul` 切 `mode: replace`）；
4. `memory_search`/`memory_get` 与 skills 目录出现在工具面。
