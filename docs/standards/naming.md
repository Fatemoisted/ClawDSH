# 命名与提交规范（naming）

## 包与代码

| 对象 | 规范 | 示例 |
|---|---|---|
| 项目名 | ClawDSH（CLI 前缀候选 `clawdsh` / 与 dsh 并列） | — |
| 自有包名 | `@clawdsh/dsh-<kebab-case>`，与上游 `@deepseek-ai/dsh-*` 同构 | `@clawdsh/dsh-soul` |
| 渠道包 | `channel-<platform>` | `channel-telegram` |
| 包内目录 | 跟上游包惯例（`src/`、`lib/` 构建产物、README 必带四段模板） | — |
| 服务 key | `ctx.<camelCase>`，新 seam 必须 ADR 命名 | `ctx.channels` |
| 事件名 | 跟 dsh 约定（域/动词，如 `channel/inbound`） | 见 ADR-0002 细化 |

## 文档

| 对象 | 规范 | 示例 |
|---|---|---|
| ADR | `docs/adr/NNNN-<kebab>.md`，四位数编号递增，含状态/日期/上下文/决策/后果/备选 | `0002-channel-seam.md` |
| 功能规格 | `docs/specs/feature-<kebab>.md`，五段式（目标/非目标/接缝/配置面/验收标准） | `feature-soul.md` |
| 开发日志 | `docs/journal/YYYY-MM-DD.md`（同日多次工作追加同文件） | `2026-08-14.md` |

## Git

- **Commit**：Conventional Commits，作用域用包名：
  `feat(soul): 初始人格 provider`、`docs(adr): 新增渠道 seam 决策`、`fix(channel-core): 入站路由重试`；
  尾部署名惯例保留上游的 `Co-Authored-By` 形式（AI 辅助提交需注明）。
- **分支**：`master` = 上游镜像（只 fast-forward）；`clawdsh` = 开发主干；特性分支 `feat/<kebab>` 从 `clawdsh` 切出，合并回 `clawdsh` 后删除。
- **上游同步产生的提交**（rebase 上游）不混入功能 commit，rebase 保持线性历史。
