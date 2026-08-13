# 功能规格：Soul（人格系统）

- **状态**：planning（Spike 候选 #1）
- **OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处：待阶段 1 基线定稿后补 PR/文档链接。

## 目标

- 每个 agent 可绑定一个"人格"：一段可版本化、可分享的人格定义（自述、口吻、行为准则、默认回复习惯）；
- 人格作为 dsh system-prompt 装配的 provider 挂载：替换/叠加默认系统提示词；
- 人格切换热插拔：卸载即回卷，无需重启；
- 人格内容通过 profile/patch 配置，不改上游源码。

## 非目标

- 不做人格市场/分享协议（后续可复用 ClawHub 式分发，另立规格）；
- 不做多智能体间的人格社交（阶段 3 后再议）。

## 接缝

dsh `packages/core/system-prompt` 的装配机制（Spike 首要任务是确认该接缝的 provider 注册方式与替换粒度）。

## 配置面（草案）

```yaml
soul:
  enabled: true
  source: ./souls/<name>.md        # 或远端 URL / ClawHub 引用
  # 叠加模式：replace（替换默认系统提示）| append（追加段落）
  mode: replace
```

## 验收标准

1. `--profile openclaw` 下 agent 的系统提示词来自配置的人格文件；
2. 切换人格 patch 后新会话生效，旧会话不受影响；
3. 卸载插件后系统提示词恢复默认；
4. 人格文本进入 session log（"model-visible means logged"）。
