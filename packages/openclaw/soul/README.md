# @clawdsh/dsh-soul

**定位**：人格系统（Soul）——OpenClaw 的 Soul 概念在 dsh system-prompt 接缝上的落地：每个 agent 作用域可挂载一个"灵魂"（Markdown 文件或内联文本），成为该 agent 的系统提示词身份。这是 ClawDSH 阶段 0 Spike 的验证对象。

**OpenClaw 对应**：Soul 系统（人格、口吻、行为准则）。基线出处待阶段 1 定稿后补链接（见 docs/matrix/parity.md）。

**接缝**：`ctx.systemPrompt`（`@deepseek-ai/dsh-system-prompt`）+ `@deepseek-ai/dsh-scope` 的作用域原语。**不新增 seam**。与上游 `@deepseek-ai/dsh-persona` 同构（scope-only 行），差异在于：文本来自灵魂文件 + `append` 模式作为独立段落叠加（保留部署人格），而非仅影子替换。

**规格**：docs/specs/feature-soul.md · **状态**：implemented（Spike ✅）

## 使用

挂载在 agent 作用域内（即 agent preset 的 `agent.cordis.yml` 里，见 `../preset-openclaw/`）：

```yaml
- id: soul
  name: '@clawdsh/dsh-soul'
  config:
    source: ./souls/assistant.md   # 相对 process.cwd()；优先于 text
    # text: 也可以直接内联
    mode: replace                  # replace=灵魂即完整系统提示；append（默认）=叠加段落
    precedenceNote: true           # append 默认：灵魂文本前加优先级声明；replace 永不添加
    includeRuntimeContext: true    # false 时抑制该作用域的运行时上下文快照
```

## 设计要点

- **scope-only**：无作用域挂载直接报错（避免发布进程级灵魂），与上游 persona 的约束一致；
- **挂载即定格**：灵魂文本在挂载时读取一次，运行期不变——提示前缀稳定，KV 缓存复用不受影响（沿用上游设计）；换灵魂 = 重新挂载（patch + 会话重启）；
- **优先级声明**：append 模式在灵魂文本前烘焙 OpenClaw 风格的优先级声明（`SOUL_PRECEDENCE_NOTE`），把人格定位为可被更高优先级指令（如用户直接指令）覆盖的 persona/tone 指导；`precedenceNote: false` 关闭，replace 模式永不添加；
- **可逆**：全部注册走 `ctx.effect()`，卸载即回卷（热插拔）；
- **日志不变式**：灵魂文本作为 prompt section 参与装配，"model-visible means logged" 由上游 session 机制保证。

## 变更说明

- 0.1.0：Spike 初始实现（replace/append 双模式 + 文件加载 + 契约测试）。
- 2026-08-14：append 模式新增优先级声明（`precedenceNote`，默认 true；见 Model Experience）。

## Model Experience

### Append-mode soul system prompt section

#### What the model sees

The `clawdsh:soul` section rendered right after the deployment persona, with the precedence note baked in ahead of the soul text and separated from it by one blank line. The note tells the model that the soul is persona-and-tone guidance, overridable by higher-priority instructions such as direct user instructions. Replace-mode souls render as the complete system prompt instead — no note, no other section.

##### Verbatim precedence note

```markdown
Soul: persona and tone. Follow it unless higher-priority instructions (such as direct user instructions) override it.
```

#### Token effect

Fixed for a given mount: in append mode the note costs about 20 tokens on every request that agent makes, and none for any other agent. With `precedenceNote: false` it costs nothing; replace mode never adds it.

#### KV Cache effect

Prefix-stable for the life of the mount: the note is baked in at mount time, ahead of the soul text, so the rendered section stays immutable until a re-mount (patch + session restart) swaps the soul or the flag. Either change invalidates reuse only from the soul section onward.

## Known Limitations and Deferred Work

- **路径相对 cwd**：`source` 相对 process.cwd() 解析，没有项目根或 agent 目录锚定。
- **无热重载**：挂载即定格，运行期改 soul 文件不生效；换灵魂或换 flag 需重新挂载（patch + 会话重启）。
- **无远端引用**：不支持 OpenClaw 的远端 URL / ClawHub 引用，灵魂只能来自本地文件或内联文本。
