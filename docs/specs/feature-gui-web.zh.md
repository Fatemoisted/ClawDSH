# Feature spec：ClawDSH 本地 GUI

[English](feature-gui-web.md) | 中文

- **状态**：ClawDSH 产品壳、能力总览、可编辑 Settings 控制面与语义 Activity 已经实现
- **组装位置**：`packages/openclaw/preset-openclaw/product-shell/`
- **产品角色**：与 Gateway 接入的通讯前台并列的 ClawDSH 本地前台

## 产品边界

`clawdsh` profile 启动一个 dsh Host 进程并提供两个浏览器应用。`/clawdsh/` 是 ClawDSH 产品入口，`/` 则保留未修改的 dsh Web 应用，并以「Harness 高级」暴露。两个应用使用相同的 Host service、Session、Connection transport 与持久化。单独启动的 `dsh --profile web` 进程仍是纯净 Harness 入口。

产品边界是进程级 `clawdsh` profile，而不是逐 Session preset 选择。新的产品 Session 使用显示为 `ClawDSH 模式` 的 `clawdsh` preset；产品入口不提供内部 `clawdsh-messaging-safe` 组合或 legacy user preset。Harness 高级保留完整 preset manager，在那里选择其他 preset 只会改变该 Session 的 Agent 组装，不会卸载 ClawDSH Host plugin。

产品壳不增加模型可见输入。对话请求继续使用所选 agent preset 与已挂载的能力 plugin。

## 路由与导航

Host 以 HTTP 308 把 `/clawdsh` 重定向到 `/clawdsh/`，并保留 query string。`/clawdsh/` 是唯一正式产品 route。`/clawdsh/settings`、`/clawdsh/settings/`、`/clawdsh/activity` 与 `/clawdsh/activity/` 都是 deprecated alias，会以 HTTP 308 重定向到正式 route 并保留 query string。Protocol-v1 bootstrap response 为兼容保留不带末尾斜杠的 route field；移除它们需要单独修改 protocol version。未知 `/clawdsh/*` 路径渲染产品内 404。

产品使用原生 Harness 信息架构。唯一的 sidebar 承载新 Session 与历史记录，其既有「设置」按钮打开默认首先显示 ClawDSH 的面板，`Harness 高级` 则作为附加 footer link 指向 `/`。已选 Session 显示 `对话 | 轨迹 | ClawDSH 记录`；界面不存在第二个产品 sidebar 或重复的「对话」按钮。

ClawDSH runtime 隐藏原生 Host ready line，只在 Loader settle 后打印 `clawdsh web: http://127.0.0.1:<port>/clawdsh/`。启动失败或 runtime 已 dispose 时不会打印成功的产品 URL。

## 对话组装

「对话」从公开 boot manifest 与静态 module table 加载完整原生 dsh Client plugin 图。`ClawdshWebEntry` 使用公开 Loader、`createSlotRenderer()` 与 `buildRenderApp()` 组装，并让生成的一棵 Harness root 始终挂载在最小 ClawDSH root 容器内。因此 Chat、Session 选择、流式输出、审批、工具、Settings 与 raw Trajectory 仍归 dsh 所有；ClawDSH 不复制其状态，也不实现替代品。

产品组装只向既有公开 Slot 贡献内容：`conversation.hero.agentPreset` 固定 `ClawDSH 模式` identity，`sidebar.footer.action` 添加 Harness 高级，`settings.section` 添加第一个 Settings 分区，`conversation.view` 添加第三个 Session 标签。它只从产品 transcript 隐藏带有稳定语义标记 `[data-variant='think']` 的 row。Harness 高级保留原生 preset control，完整推理内容继续在 raw Trajectory 中提供。集成不使用私有 import、布局 selector、标签文本查找或模拟 DOM click。

Browser、Host runtime 与 shared protocol 组成 `preset-openclaw/product-shell/` 下的嵌套非 workspace build。构建把浏览器应用输出到 runtime distribution，并使用 Vite base `/clawdsh/`。`tools/link-clawdsh.sh` 在 runtime 与 browser artifact 均存在前拒绝安装开发 profile，随后把 runtime 以 `@clawdsh/dsh-product-runtime` 链接。

## 本地控制面

冻结的 protocol-v1 Connection channel 是 `/clawdsh-rpc`。它以 loopback-only authority 注册，因此配置的 trusted host 不能调用。每个 request 都是严格的 versioned object；未知字段、version、endpoint、response field、namespace、setting path、credential id 与 prototype-pollution path segment 都会校验失败。已实现 method 为：

- `bootstrap/get`：返回产品 identity、稳定 route，以及本地可读写控制模式。
- `capabilities/list`：返回仅含 JSON 的产品能力、净化后的 Loader 证据与锁定的 OpenClaw channel catalog。
- `settings/describe`、`settings/mutate` 与 `settings/reset`：只暴露产品 allowlist 中的 schema 与字段，并使用 optimistic revision。
- `credentials/describe`、`credentials/set` 与 `credentials/unset`：为 allowlist 中的 dsh 自有 reference 暴露不含 secret 的状态与只写 mutation。
- `activity/list`：返回一个限制隐私的当前 Session 页面，数据由 standard Session history 与有界 ClawDSH sidecar 合并而成。

控制 runtime 返回 data-transfer object，而不是 live Cordis object。Connection 不是 loopback 时，浏览器也会拒绝产品控制调用。远程 trusted-host 页面仍可使用 Harness 对话，但 ClawDSH Settings、credential 与 Activity 控制数据只在本机提供。

## 能力总览

主要状态视图只包含 Soul、Memory、Skills Hub、Channels 与 Automation 五项用户功能。Activity 是必需的观测基础设施，只出现在默认收起的实现详情中。Package 名、组件 row、状态来源、channel catalog 与完整 Loader inventory 也保留在该诊断区域。

Browser presentation 会组合三个 protocol-v1 response，但不修改其 schema。`capabilities/list` 证明 package 与 Fiber 是否装载，`settings/describe` 证明 desired/runtime setting 与重启时机，`credentials/describe` 只证明 allowlist credential 是否已配置。UI 会区分四种含义：实现已装载、业务 effect 已启用、配置已齐备，以及存在真实运行证据。它不会用前三种推断第四种；未知或畸形证据会降级为「状态未知」，不会让整个面板崩溃。

- Loader 状态为 `disabled`、`starting`、`active`、`failed` 或 `misconfigured`，从配置 entry 与观测到的 Fiber lifecycle 推导。
- 渠道支持为 `cataloged`、`installable`、`certified` 或 `enabled`，从明确的产品证据推导，绝不从 Gateway 进程正在运行推断。

即使 Cordis 会让 group carrier 本身保持 active 并省略已关闭的子 entry，受管 communication-plane 父组的关闭状态仍是 Channels 的权威依据。只有默认 `clawdsh` preset 包含准确且已启用的受管 Soul entry，并且它的 standing composition 成功挂载时，Soul 才显示为 active。

Channels 包含三个组件：Channel Protocol（`@clawdsh/dsh-channel`）、Agent Bridge（`@clawdsh/dsh-channel-agent`）与 OpenClaw Gateway Provider（`@clawdsh/dsh-channel-openclaw`）。飞书、Telegram 与其他锁定 production entry 在 Gateway 下显示为支持状态为 `cataloged` 的 catalog item；它们不是独立 dsh plugin card。Raw Loader inventory 不包含直连 platform-adapter entry。

Package 来源遵循固定映射：`@clawdsh/*` 属于 ClawDSH，`@deepseek-ai/*` 与 `cordis:*` 属于 Platform，其他来源全部属于 Community。

干净安装时，Soul 显示「新会话启用」，Memory 显示「已启用」并在需要时提醒 Ark 配置，Skills Hub 显示「来源已启用」，Channels 显示「尚未连接平台」，Automation 显示「尚未设置」。Skills 状态只证明 ClawHub 兼容来源已参与，是否实际发现 Skill 会在目录扫描时验证。Ark Key 已配置只表示首次调用时验证。Channel 状态会组合 Loader 状态与经过净化的 `ctx.channels.health()` 证据：已验证 handshake 显示「Gateway 与 Bridge 已认证连接」，ready account 会按 channel 计数且不暴露 account id，handshake 存在但 account 为空时则说明 OpenClaw 没有暴露逐账号状态。Automation 会区分无规则、保存了规则但关闭、已启用但没有可运行规则、正常运行与 Loader 组装失败。总览计数只覆盖这五项功能。

## Settings 语义

固定 namespace 是 `clawdsh-soul`、`clawdsh-channel-agent`、`clawdsh-channel-openclaw`、`clawdsh-memory`、`clawdsh-embeddings-ark`、`clawdsh-skills-hub`、`clawdsh-automation` 与必需且受管的 `clawdsh-activity` namespace。Channel Protocol 是必需基础设施，没有用户 namespace。Server 自有 manifest 控制字段顺序、文案、editor 选择、依赖，以及每个准确字段是可编辑还是 installer-managed；浏览器不能扩大该 allowlist。

每项能力注册自身已有 Config schema。值按 `schema default → profile base → user settings` 顺序解析。Reset 只移除 namespace 的 user layer。Mutation 携带 `expectedRevision` 与数量受限、非空且 path 不重复的 `set` 或 `unset` operation 集合；Host 原子校验并持久化完整集合。过期写入返回 `settings-conflict`，不 merge，也不 retry。Response 区分 `desiredRevision` 与 `runtimeRevision`，通过 desired/runtime value 计算 `restartRequired`，并把生效时间标为 `live`、`new-session`、`next-call` 或 `restart`。

可选 business plugin 保留在 Loader 组装中，让 schema 持续可用。它们的 `enabled` 字段控制业务 effect：关闭的 Memory 不注册 prompt、tool、watcher 或 flush，关闭的 Skills Hub 不注册 provider，关闭的 Automation 不创建 timer、runtime 或 Automation Session，但保留管理工具。Automation 设置即时协调；Soul 修改影响新 Session。Channel Agent 是必需能力，自身保持 network-inert。

OpenClaw Gateway 以 `enabled=false` 保持 mounted，此时不检查 artifact、不绑定 socket、不启动进程，也不注册 Provider。启用时会在持久化前运行 managed-deployment preflight，因此 preflight 失败会让值与 revision 保持不变。Deployment identity、path、extension 与 media limit 可见但只读。Gateway process 状态绝不表示 platform account 已 ready、certified 或 enabled。

Ark Embeddings 只使用固定 `ARK_API_KEY` credential reference，并在每次调用时解析它。Credential RPC 暴露 configured 与 writable metadata，但绝不返回值。OpenClaw 独占飞书、Telegram 与其他 platform credential；它们不会进入 dsh credentials、Settings RPC、保留的浏览器状态、日志、Session file 或 Activity storage。

一个随 plugin 生命周期存在的内存 store 拥有加载、snapshot、namespace draft、credential draft、保存与冲突状态、展开状态和 dirty key。关闭 Settings、切换到其他原生 section 或重新打开面板都不会丢弃 draft。ClawDSH section 卸载后，dirty key 仍会维持页面卸载提醒；保存、重置、重新加载、显式清空与接受新值会清除对应 key。该 store 不写入 local storage 或 Session file。

配置按功能分组，而不是按 raw namespace 平铺。Soul 只有一个标题；Memory 包含 Memory 行为、Ark 语义搜索与 Ark Key；Channels 包含 Agent Bridge 与 OpenClaw Gateway；Skills Hub 与 Automation 各有一个功能组。通用 editor 支持 schema 描述的 string、number、boolean、enum、nested object 与 string array。已有 Channel 与 Automation Session 保留创建时 `cwd`，因此它们的 workspace 由安装器管理。Automation 原子保存完整 `rules` 字段，编辑时保留私有的原渠道 delivery metadata，为每个新增任务生成基于 UUID 的持久 id，并立即应用该修订；Gateway 在持久化前运行 deployment preflight，optimistic revision conflict 会保留 draft，直到显式重新加载。

Credential value 只存在于 store 的私有 browser memory 与发出的写请求中。成功、失败、显式清空与 plugin dispose 都会擦除该值。Error、response、log、持久化 browser storage、Settings file、Session file 与 Activity sidecar 均不保留它；credential descriptor 始终不含 secret。

## 语义 Activity

第三个「ClawDSH 记录」标签使用 `conversation.view` 提供的 Session id，并呈现身份/上下文、Memory、外部消息、Skill 与定时任务记录。它支持 category filter、正反时间排序与绑定读取快照的 cursor pagination；切换 Session 或卸载标签会中止旧请求并重置 continuation。新回合完成后会自动重新读取第一页，始终可见的手动重新读取用于获取稍后到达的 sidecar-only 事实。面向用户的 card 用中文解释已观察到的结果，区分 Memory 真实变更与无修改结果，也不会把没有匹配结果的 `started` event 描述成确定仍在运行。Session seq、固定 kind、digest 与其他实现字段留在收起的技术详情中。相邻「轨迹」标签提供标准 Session diagnostic，但 sidecar-only failure 不一定有对应 raw row，因此记录标签不会承诺所有细节都能在那里找到，也不模拟跨标签导航。

始终挂载的 `@clawdsh/dsh-activity` service 会把从 standard Session history 投影出的隐私安全事实，与保存 ClawDSH 独有贡献的有界 owner-private sidecar 合并。Sidecar 缺失、损坏或不可写只会让该视图降级；history 与 sidecar 可以分别继续使用，任何产品 response 都不会返回 source path 或 error。固定的 kind 专用 component 呈现记录，不提供 raw JSON 展开。[Activity 规格](feature-activity.md)拥有记录词汇、privacy mapping、存储、分页与降级行为。

## 集成约束

- ClawDSH 不 fork 或重新实现 dsh Chat、Session 状态、流式输出、审批、工具呈现、原生 Settings 或 raw Trajectory。
- ClawDSH 不注册新 Client Slot，也不进入根 Client aggregate 或 Client Catalog。产品浏览器只向既有公开 `conversation.hero.agentPreset`、`sidebar.footer.action`、`settings.section` 与 `conversation.view` Slot 贡献内容。
- ClawDSH 只导入公开 package export；不导入上游 `src/*` 路径，也不修改 `api-proxy`、Agent Loop、generated file 或上游自有源码。
- 产品使用 `/clawdsh/` 作为静态路由，并使用不重叠的 `/clawdsh-rpc` 名称作为 Connection RPC。
- 物理 `preset-openclaw` 目录保持内部实现，因为既有仓库检查对该路径提供窄例外。安装 id、命令与产品文案使用 `clawdsh`。

## 当前验证

嵌套 build 拥有独立 browser/runtime typecheck、focused test 与 build output 检查。真实 profile keyless journey 会运行正常 `clawdsh` profile，等待 Loader-settled 产品 URL，并验证单一 sidebar、原生 Settings section、三个 Session 标签、安全默认状态、语义记录、响应式布局、legacy redirect、产品 404 与干净 console。Focused package、protocol、runtime 与 browser coverage 校验严格 request、mutation 与 reset、stale revision、restart state、plugin-lifetime draft、卸载提醒、公开 Slot 注册、presentation fallback、preflight-before-persist 行为、不含 secret 的 response、credential cleanup 与 dispose、Activity privacy 与 availability、Session 切换及卸载 cancellation、filter、cursor pagination 与兼容 redirect。
