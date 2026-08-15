# ADR-0011：旧渠道延迟式图片导入与会话地址连续性

[English](0011-deferred-channel-images-and-address-continuity.md) | 中文

- **状态**：已接受，仅适用于 legacy compatibility path（2026-08-15）
- **日期**：2026-08-15
- **依赖**：ADR-0002（旧渠道 seam）、ADR-0010（Harness 约定优先复用）
- **范围边界**：新的渠道平面工作已由 ADR-0008 取代

## 上下文

保留的进程内 adapter path 接收生命周期不同的 provider 数据。provider 图片 id 是临时定位符，Harness 附件引用才是经过验证的持久 Session 输入。在群聊 mention 准入前下载图片，会为最终被旧渠道策略拒绝的消息消耗网络和存储；向未声明图片输入能力的模型发送图片内容，还可能把其所选模型无法消费的输入写进持久 Session。

provider 会话地址可能独立于持久会话身份发生变化。Telegram 群组迁移为超级群组时会替换投递 chat id，而迁移服务消息可能与普通消息竞态到达。收到迁移通知后自动移动或复制 Session，无法确定并发消息实际由哪个地址接收。

Telegram 轮询具有相同的持久化约束。并发处理 update 只有在轮询偏移越过已准入 update 前先将其持久记录时，才能安全提升跨 chat 吞吐；旧 seam 没有持久入站队列或 provider outbox。

ADR-0008 已把当前通信平面的职责交给锁定的 OpenClaw Gateway sidecar。因此，本决策只描述保留的 `ctx.legacyChannels` compatibility 实现；其测试与历史真实流量不能认证 sidecar 的媒体、身份、准入或投递行为。

## 决策

1. **provider 图片描述符保持临时。** 旧 `ChannelMessage.images` 只携带 provider 所属的 `ChannelImageSource` 描述符，包括不透明文件 id 与声明的媒体元数据。描述符、provider 文件 URL 和下载字节都不写入 Harness Session log；只有经过验证的 `ImageAttachmentRef` 可以成为模型可见的持久输入。
2. **旧 channel core 管理图片准入顺序。** 它先执行群聊 mention 策略，再把回合准入稳定会话 FIFO，并在该 FIFO 内为线程选定的精确 provider/model 解析 `inputModalities`。仅当该模型明确声明 `image` 输入时，core 才调用 `ChannelAdapter.materializeImages`。
3. **adapter 负责导入，Harness 负责验证和存储。** Telegram adapter 使用维护中的 `@grammyjs/files` 集成获取已准入的 provider 文件，执行 Harness 附件数量和字节上限，再将字节交给 `ctx.attachments.validateImage` 与 `ctx.attachments.saveImage`，最后向旧 channel core 返回附件引用。所有选中图片都成功物化后，core 才追加用户事件。
4. **纯文本路由继续可用，但不伪称看过媒体。** 带 caption 的消息作为文本回合继续执行，并附加固定的、模型可见的图片省略上下文。纯图片消息只收到固定投递提示，不追加用户回合；导入失败也返回固定提示，不部分追加图片。
5. **投递地址与持久身份分离。** `conversationId` 始终是当前 provider 发送目标，可选的 `sessionConversationId` 选择持久 Session 与 FIFO 身份。Telegram 部署通过 `chatIdAliases` 记录经过验证的“当前地址到稳定身份”映射；冲突和循环映射均无效。观察到没有 alias 的迁移时，adapter 会在当前进程暂停该 chat 并报告所需映射，但该暂停只是 best-effort，不能代替持久的部署配置。
6. **入站实现持久化前保持等待式轮询。** Telegram 保留官方长轮询路径，其中 middleware 会等待渠道回合完成。只有先具备持久入站队列与恢复语义，并发 runner 才能在 Session 持久化之外独立推进 provider 偏移。

## 后果

- 因 mention 被拒绝的图片消息和纯文本模型收到的图片消息不会触发 provider 下载、附件写入或在旧 Session log 中产生不受支持的图片块。
- 支持图片的路由复用 Harness 附件验证、存储和持久引用，无需建立渠道专属二进制持久化。
- adapter 只能在入站回合生命周期内保留 provider 描述符；进程丢失后的重试从 provider 重新投递开始，而不是依赖 Session 内保存的文件定位符。
- Telegram 更改 chat id 时，运维人员必须维护 `chatIdAliases`。进程内迁移暂停可以减少观察到迁移后的意外 Session 分裂，但无法保护重启场景，也无法保护早于迁移服务 update 到达的消息。
- 在持久入站队列使跨 chat 并发具备可恢复性之前，缓慢的 Telegram 回合可能延迟其他 chat 的轮询工作。
- 新的媒体、身份与投递工作属于 ADR-0008 sidecar 及其认证门禁，不应继续扩宽这个旧约定。

## 备选方案

- **adapter 在渠道准入前下载（被否决）**：未 mention 的群聊媒体与纯文本路由会在 core 策略接受之前消耗 provider 带宽、内存、验证工作，并可能占用存储。
- **把 provider 文件 id 或 URL 持久化进 Session（被否决）**：provider 定位符可能过期、依赖渠道凭证，且不是经过验证的模型输入；持久化它们会让回放依赖在线传输账号。
- **自动写入迁移 alias 或复制 Session（被否决）**：迁移 update 与普通消息可能以任意顺序到达，adapter 没有原子证据可保证 Session 复制或地址改写完整且无竞态。
- **没有持久入站时使用并发轮询 runner（被否决）**：已准入回合到达 Session 持久化检查点前推进 provider 偏移，会在进程失败时丢失该 update。
