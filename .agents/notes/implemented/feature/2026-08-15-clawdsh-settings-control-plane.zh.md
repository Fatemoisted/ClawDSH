# Agent Note: ClawDSH Settings 控制面

Status: implemented

[English](2026-08-15-clawdsh-settings-control-plane.md) | 中文

[本地 GUI 规格](../../../../docs/specs/feature-gui-web.md)拥有当前用户可见行为。本决策拥有更广泛[产品壳决策](../../implemented/architecture/2026-08-15-clawdsh-product-shell.md)中的 Settings 部分；语义 Activity 的独立存储与 projection 规则见其[功能规格](../../../../docs/specs/feature-activity.md)。

## Problem

ClawDSH 产品壳能够识别能力归属与 Loader 健康状态，但只读清单无法让用户配置产品。原始 Loader mutation 也不是安全替代：可选行为、依赖、校验、凭据与生效时间属于实现它们的能力，而卸载 plugin 可能移除修复配置所需的 schema。

本地 Settings UI 还会跨越持久化和 secret-bearing interface。并发浏览器草稿不能覆盖更新的值，reset 必须保留安装器自有的 profile 配置，已经保存但需要重启的值不能被报告为已生效，而且 secret value 不能通过 RPC 返回或留在浏览器状态中。

## Decision

仅限 loopback 的 `/clawdsh-rpc` protocol v1 在现有只读 method 旁提供 `settings/describe`、`settings/mutate`、`settings/reset`、`credentials/describe`、`credentials/set` 与 `credentials/unset`。Request 使用严格的 versioned object；Host 在持久化前拒绝未知字段、namespace、credential id、setting path 与 prototype-pollution path segment。Namespace 顺序、文案、依赖、editor 选择与字段写权限归 product manifest 所有，而不归浏览器输入所有。

固定 Settings namespace 为：

| 能力 | Namespace | 产品行为 |
|---|---|---|
| Soul | `clawdsh-soul` | 用户可编辑；修改影响新 Session |
| Channel Protocol | — | 必需 Service Definition，没有用户 namespace |
| Agent Bridge | `clawdsh-channel-agent` | 必需；受管 preset 与 media 字段保持只读 |
| OpenClaw Gateway | `clawdsh-channel-openclaw` | 默认关闭；部署 identity 与 path 保持受管 |
| Memory | `clawdsh-memory` | 默认启用；重启后改变 runtime effect |
| Ark Embeddings | `clawdsh-embeddings-ark` | Memory 依赖；API key 是独立的固定 credential reference |
| Skills Hub | `clawdsh-skills-hub` | 默认启用；重启后改变 provider registration |
| Automation | `clawdsh-automation` | 默认关闭；rules 作为一个原子字段保存 |
| Activity | `clawdsh-activity` | 必需 package namespace，仅包含受管字段 |

每个 namespace 都向 dsh Settings service 注册自身已有 Config schema。解析顺序是 `schema default → profile base → user settings`；`reset` 会移除该 namespace 的完整 user layer，绝不改写 profile base 配置。Host 返回 resolved value、schema、存在时的 base 与 user layer、字段权限、生效时间，以及相互独立的 `desiredRevision` 与 `runtimeRevision` 值。

每次 mutation 都携带 `expectedRevision` 与数量受限、非空且 path 不重复的 `{ op: 'set' | 'unset', path, value? }` operation 集合。Server 校验完整 candidate 并原子持久化整组 operation，因此跨字段约束不会观察到只保存一半的 draft。过期 revision 以 `settings-conflict` 失败；server 不 merge，也不 retry。`restartRequired` 比较 desired value 与 runtime value，而不是比较 revision number，因此修改后又 reset 到已应用值会清除 restart marker。生效时间为 `live`、`new-session`、`next-call` 或 `restart` 之一。

ClawDSH capability plugin 保留在 Loader 组装中，让 schema 与健康状态持续可用。经过校验的 `enabled` 字段在 mount 时控制业务 effect：关闭的 Memory 不注册 prompt、tool、watcher 或 flush 行为；关闭的 Skills Hub 不注册 provider；关闭的 Automation 不创建 timer、runtime 或 Automation Session。Soul 使用 Host 自有 singleton namespace，Session 实例只读取 resolved value，因此现有 Session 不会改变。Agent Bridge 保持必需，且自身不执行外部网络工作。

OpenClaw Gateway 以 `enabled=false` 保持 mounted，此时不校验 artifact、不绑定 socket、不启动 Gateway，也不注册 Provider。尝试启用时，会在持久化前运行完整 managed-deployment preflight；失败会让存储值与 revision 都保持不变。受管 track、deployment identity、artifact/runtime/config/state/staging/socket path、锁定 extension 与 media limit 可见但只读。Gateway 正在运行不表示任何 platform account 已 ready、certified 或 enabled。

Ark Embeddings 使用固定 `ARK_API_KEY` credential reference，并在每次调用时解析它。它不接受 literal API key setting。Credential RPC allowlist 只暴露 dsh 自有 credential，只报告 configured 与 writable 状态而不返回值，也绝不包含飞书、Telegram 或其他 OpenClaw platform credential。那些 platform secret、account 与 state 只归 OpenClaw 所有；它们不会进入 dsh credentials、Settings RPC、浏览器状态、日志、Session file 或 Activity storage。

Settings 页面为每个 namespace 保存独立 draft 与 revision。Schema metadata 驱动通用 string、number、boolean、enum、nested-object 与 string-array 字段；product manifest 选择专用 Automation rules 与 Gateway deployment editor。发生冲突时会保留 draft，并阻止再次保存，直到用户显式重新加载该 namespace。Credential value 只存在于 password field 与发出的 set request 中；无论成功或失败，浏览器都会在 `finally` 中清空该字段，response 与保留的 component state 只包含不含 secret 的 descriptor。

## Verification

Protocol 与 runtime test 固定了严格 object parsing、静态 allowlist、污染 path 拒绝、过期 revision 冲突、reset layering、desired/runtime value 比较、preflight-before-persist 顺序，以及不含 secret 的 credential response。Capability test 固定了关闭的 plugin 仍可被描述而业务 effect 不存在，并且 Ark 只解析固定 reference。

Browser test 固定了独立 draft、schema control、原子 Automation editor、受管 Gateway 字段、冲突后重新加载行为，以及成功和失败 request 后的 credential cleanup。Keyless real-profile journey 在没有 OpenClaw artifact 或外部 credential 时启动，发现所有已挂载的能力 namespace，确认 Gateway 处于关闭状态，并确认 platform credential 不在产品控制面中。Focused Host test 覆盖 mutation、reset、restart state 与 stale-write rejection。

必需 Activity package 注册受管 Activity namespace。其 Session-history projection、sidecar record、pagination 与 UI 由独立 Activity 规格管理，不属于 Settings mutation model。

## Alternatives considered

**暴露任意 Loader 启停控制。** Loader entry 是实现组装，而不是稳定产品配置 API。卸载能力可能移除其 validation 与 dependency，因此高级 inventory 保持只读。

**通过产品 RPC 代理所有 dsh namespace 与 credential。** 这会让 ClawDSH 浏览器获得 product manifest 之外的平台与社区配置权限。静态 namespace、field 与 credential allowlist 让权限可审查且 fail closed。

**接受 last-writer-wins 修改或自动 retry 冲突。** 两者都可能在作者不知情时替换更新值。Optimistic revision 会保留被拒绝的 draft，并要求显式重新加载。

**把 OpenClaw platform credential 存入 dsh。** 复制飞书、Telegram 或其他 account secret 会产生两个 owner，并扩大 disclosure path。OpenClaw 保持 sole owner，ClawDSH 只管理自身直接消费的 Ark credential。

**让所有修改实时生效。** 多个 plugin 会在 mount 时建立 timer、watcher、provider 或 Session-scoped prompt state。把这些值报告为 live 并不真实；明确的 effect timing 与 runtime-value 比较会暴露所需 restart 或新 Session transition。

## Consequences

用户可以在一个产品页面配置 ClawDSH，而不会获得任意 Loader 或 credential 权限。冲突失败不会丢失数据，reset 会保留部署默认值，UI 也会区分 desired value 与 mounted runtime 正在使用的值。

Server 自有 product manifest 必须与 capability schema 和受管 installer 字段保持同步。Restart-bound setting 不会刻意修改已挂载 plugin effect，Soul 修改需要新 Session。OpenClaw deployment 在 managed runtime 通过 preflight 前保持不可用，platform account readiness 继续要求 OpenClaw 自有证据。

控制面保持仅本机可用。Remote trusted-host 用户可以使用「对话」，但不能读取或修改产品 Settings 或 credential。语义 Activity 通过自身 read protocol 组合在同一 local channel 上；公共发行不属于本决策。
