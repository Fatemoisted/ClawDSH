# 功能规格：Memory（个人助手记忆）

- **状态**：planning
- **OpenClaw 对应**：Memory 系统（长期记忆：人/事/偏好，跨会话检索）。基线出处：待阶段 1 基线定稿后补 PR/文档链接。

## 目标

- 提供"跨会话长期记忆"能力：agent 能记住用户说过的人、事、偏好；
- 检索结果注入当前会话上下文时遵守日志不变式；
- 后端可替换（sqlite/jsonl/远端），沿用 dsh 的 provider 模式。

## 非目标

- 不做向量数据库/自研检索引擎（优先复用 dsh 既有持久化与检索设施，必要时引入成熟库）；
- 不做多用户记忆隔离（跟随 dsh 的 agent/session 隔离模型）。

## 接缝

候选：`ctx.spillStore`（溢出存储）与 `ctx.sessionPersistence`（会话持久化）。
Spike 任务：验证两个接缝的语义差异（谁承载"跨会话事实"，谁只负责会话日志），选定后写死在本节。

## 配置面（草案）

```yaml
memory:
  enabled: true
  backend: sqlite                # sqlite | jsonl | <provider 注册名>
  recall:
    mode: always | on-query      # 注入时机
    budget: 2000                 # 注入 token 预算
```

## 验收标准

1. 会话 A 写入一条记忆事实，会话 B 可检索到；
2. 检索注入内容出现在 session log 中；
3. 更换 backend 无需改动其他插件；
4. 记忆写入/更新是幂等事件（append-only log 兼容）。
