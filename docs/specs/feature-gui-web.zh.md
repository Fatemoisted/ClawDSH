# Feature spec：ClawDSH 本地 GUI

[English](feature-gui-web.md) | 中文

- **状态**：ClawDSH 产品壳、能力总览与可编辑 Settings 控制面已经实现；语义 Activity 记录尚不可用
- **组装位置**：`packages/openclaw/preset-openclaw/product-shell/`
- **产品角色**：与 Gateway 接入的通讯前台并列的 ClawDSH 本地前台

## 产品边界

`clawdsh` profile 启动一个 dsh Host 进程并提供两个浏览器应用。`/clawdsh/` 是 ClawDSH 产品入口，`/` 则保留未修改的 dsh Web 应用，并以「Harness 高级」暴露。两个应用使用相同的 Host service、Session、Connection transport 与持久化。单独启动的 `dsh --profile web` 进程仍是纯净 Harness 入口。

产品边界是进程级 `clawdsh` profile，而不是逐 Session preset 选择。新 Session 默认使用显示为 `ClawDSH 模式` 的 `clawdsh` preset；选择其他 preset 只会改变该 Session 的 Agent 组装，不会卸载 ClawDSH Host plugin。

产品壳不增加模型可见输入。对话请求继续使用所选 agent preset 与已挂载的能力 plugin。

## 路由与导航

Host 以 HTTP 308 把 `/clawdsh` 重定向到 `/clawdsh/`，并保留 query string。它在 `/clawdsh/` 下提供产品 SPA 与静态 asset，只允许 GET 和 HEAD 访问静态产品路由，拒绝路径穿越，并应用 dsh 用于 boot manifest 与 theme preboot 的相同 index transform。未知 `/clawdsh/*` 路径渲染产品内 404。

固定导航为：

1. `/clawdsh/` 下的**对话**。
2. `/clawdsh/settings` 下的**ClawDSH 设置**。
3. `/clawdsh/activity` 下的**ClawDSH 活动**。
4. 全页跳转到 `/` 的**Harness 高级**链接。

ClawDSH runtime 隐藏原生 Host ready line，只在 Loader settle 后打印 `clawdsh web: http://127.0.0.1:<port>/clawdsh/`。启动失败或 runtime 已 dispose 时不会打印成功的产品 URL。

## 对话组装

「对话」从公开 boot manifest 与静态 module table 加载完整原生 dsh Client plugin 图。`ClawdshWebEntry` 使用公开 Loader、`createSlotRenderer()` 与 `buildRenderApp()` 组装，并让生成的 Harness root 始终挂载在产品壳内。因此 Chat、Session 选择、流式输出、审批、工具、原生 Settings 与 raw Trajectory 仍归 dsh 所有；ClawDSH 不复制其状态，也不实现替代品。

Browser、Host runtime 与 shared protocol 组成 `preset-openclaw/product-shell/` 下的嵌套非 workspace build。构建把浏览器应用输出到 runtime distribution，并使用 Vite base `/clawdsh/`。`tools/link-clawdsh.sh` 在 runtime 与 browser artifact 均存在前拒绝安装开发 profile，随后把 runtime 以 `@clawdsh/dsh-product-runtime` 链接。

## 本地控制面

冻结的 protocol-v1 Connection channel 是 `/clawdsh-rpc`。它以 loopback-only authority 注册，因此配置的 trusted host 不能调用。每个 request 都是严格的 versioned object；未知字段、version、endpoint、response field、namespace、setting path、credential id 与 prototype-pollution path segment 都会校验失败。已实现 method 为：

- `bootstrap/get`：返回产品 identity、稳定 route，以及本地可读写控制模式。
- `capabilities/list`：返回仅含 JSON 的产品能力、净化后的 Loader 证据与锁定的 OpenClaw channel catalog。
- `settings/describe`、`settings/mutate` 与 `settings/reset`：只暴露产品 allowlist 中的 schema 与字段，并使用 optimistic revision。
- `credentials/describe`、`credentials/set` 与 `credentials/unset`：为 allowlist 中的 dsh 自有 reference 暴露不含 secret 的状态与只写 mutation。

控制 runtime 返回 data-transfer object，而不是 live Cordis object。Connection 不是 loopback 时，浏览器也会拒绝产品控制调用。远程 trusted-host 页面仍可使用 Harness 对话，但 ClawDSH Settings、credential 与 Activity 控制数据只在本机提供。

## 能力总览

ClawDSH Settings 显示 Soul、Channels、Memory、Skills Hub、Automation 与 Activity 的依赖、生效时间、组件 package 与 Loader 状态。它保留完整只读 Loader inventory 用于诊断，而可编辑能力字段使用产品自有 Settings namespace，不使用任意 Loader mutation。

Loader 组装状态与渠道支持证据是两个独立概念：

- Loader 状态为 `disabled`、`starting`、`active`、`failed` 或 `misconfigured`，从配置 entry 与观测到的 Fiber lifecycle 推导。
- 渠道支持为 `cataloged`、`installable`、`certified` 或 `enabled`，从明确的产品证据推导，绝不从 Gateway 进程正在运行推断。

即使 Cordis 会让 group carrier 本身保持 active 并省略已关闭的子 entry，受管 communication-plane 父组的关闭状态仍是 Channels 的权威依据。只有默认 `clawdsh` preset 包含准确且已启用的受管 Soul entry，并且它的 standing composition 成功挂载时，Soul 才显示为 active。

Channels 包含三个组件：Channel Protocol（`@clawdsh/dsh-channel`）、Agent Bridge（`@clawdsh/dsh-channel-agent`）与 OpenClaw Gateway Provider（`@clawdsh/dsh-channel-openclaw`）。飞书、Telegram 与其他锁定 production entry 在 Gateway 下显示为支持状态为 `cataloged` 的 catalog item；它们不是独立 dsh plugin card。Legacy `channel-core`、`channel-feishu` 与 `channel-telegram` entry 可以出现在 raw Loader inventory 中，但不影响产品健康状态。

Package 来源遵循固定映射：`@clawdsh/*` 属于 ClawDSH，`@deepseek-ai/*` 与 `cordis:*` 属于 Platform，其他来源全部属于 Community。

## Settings 语义

固定 namespace 是 `clawdsh-soul`、`clawdsh-channel-agent`、`clawdsh-channel-openclaw`、`clawdsh-memory`、`clawdsh-embeddings-ark`、`clawdsh-skills-hub`、`clawdsh-automation` 与受管 `clawdsh-activity` placeholder。Channel Protocol 是必需基础设施，没有用户 namespace。Server 自有 manifest 控制字段顺序、文案、editor 选择、依赖，以及每个准确字段是可编辑还是 installer-managed；浏览器不能扩大该 allowlist。

每项能力注册自身已有 Config schema。值按 `schema default → profile base → user settings` 顺序解析。Reset 只移除 namespace 的 user layer。Mutation 携带 `expectedRevision` 与数量受限、非空且 path 不重复的 `set` 或 `unset` operation 集合；Host 原子校验并持久化完整集合。过期写入返回 `settings-conflict`，不 merge，也不 retry。Response 区分 `desiredRevision` 与 `runtimeRevision`，通过 desired/runtime value 计算 `restartRequired`，并把生效时间标为 `live`、`new-session`、`next-call` 或 `restart`。

可选 business plugin 保留在 Loader 组装中，让 schema 持续可用。它们的 `enabled` 字段在 mount 时控制 effect：关闭的 Memory 不注册 prompt、tool、watcher 或 flush，关闭的 Skills Hub 不注册 provider，关闭的 Automation 不创建 timer、runtime 或 Automation Session。Soul 修改影响新 Session。Channel Agent 是必需能力，自身保持 network-inert。

OpenClaw Gateway 以 `enabled=false` 保持 mounted，此时不检查 artifact、不绑定 socket、不启动进程，也不注册 Provider。启用时会在持久化前运行 managed-deployment preflight，因此 preflight 失败会让值与 revision 保持不变。Deployment identity、path、extension 与 media limit 可见但只读。Gateway process 状态绝不表示 platform account 已 ready、certified 或 enabled。

Ark Embeddings 只使用固定 `ARK_API_KEY` credential reference，并在每次调用时解析它。Credential RPC 暴露 configured 与 writable metadata，但绝不返回值。OpenClaw 独占飞书、Telegram 与其他 platform credential；它们不会进入 dsh credentials、Settings RPC、保留的浏览器状态、日志、Session file 或 Activity storage。

每张 Settings card 拥有独立 draft 与 revision。通用 editor 支持 schema 描述的 string、number、boolean、enum、nested object 与 string array；Automation 原子保存完整 `rules` 字段，Gateway 使用专用 managed-deployment view。发生冲突时保留 draft，并禁止再次保存，直到显式重新加载。Credential input 在成功或失败后的 `finally` 中清空，response 只保留不含 secret 的 descriptor。

## Activity 缺口

Activity route 当前渲染明确的空状态。它不读取 Session history，不创建 sidecar，不提供 filter，也不声称已经存在 Prompt、Memory、Channel、Skill 或 Automation 语义记录。Raw Trajectory 继续由 Harness 高级提供。

当前 RPC protocol 不实现 `activity/list`，也没有挂载 `@clawdsh/dsh-activity` package。Activity persistence、history projection、privacy mapping、degradation、filter 与 pagination 仍属于 proposal 范围。

## 集成约束

- ClawDSH 不 fork 或重新实现 dsh Chat、Session 状态、流式输出、审批、工具呈现、原生 Settings 或 raw Trajectory。
- ClawDSH 不新增 Client Slot，不调用 `ctx.slots.register()` 注入产品 UI，也不进入根 Client aggregate 或 Client Catalog。
- ClawDSH 只导入公开 package export；不导入上游 `src/*` 路径，也不修改 `api-proxy`、Agent Loop、generated file 或上游自有源码。
- 产品使用 `/clawdsh/` 作为静态路由，并使用不重叠的 `/clawdsh-rpc` 名称作为 Connection RPC。
- 物理 `preset-openclaw` 目录保持内部实现，因为既有仓库检查对该路径提供窄例外。安装 id、命令与产品文案使用 `clawdsh`。

## 当前验证

嵌套 build 拥有独立 browser/runtime typecheck、focused test 与 build output 检查。真实 profile keyless journey 会构建嵌套应用，把它安装到隔离 dsh home，等待 Loader-settled 产品 URL，验证全部产品目的地与能力 namespace，确认 Gateway 关闭且 Ark 未配置，确认未知产品 route 渲染产品 404，并确认 `/` 不包含 ClawDSH 产品导航。Focused protocol、runtime 与 browser coverage 校验严格 request、mutation 与 reset、stale revision、restart state、受管字段、独立 draft、preflight-before-persist 行为、不含 secret 的 response、credential cleanup、`clawdsh` preset 与幂等开发安装。
