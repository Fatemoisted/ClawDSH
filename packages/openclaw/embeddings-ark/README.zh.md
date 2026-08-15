# @clawdsh/dsh-embeddings-ark

[English](README.md) | 中文

**定位**：`@clawdsh/dsh-embeddings` seam 的第一个 provider——火山方舟（Volcano Ark）文本嵌入。POST Ark 的多模态端点 `/embeddings/multimodal`，只发 `type: "text"` 输入；wire format 与原生 `fetch` 客户端是 provider 私有实现，不走 `ctx.llm`（dsh 的 LLM seam 没有 embedding 端点）。**wire shape 已经 2026-08-14 真实 e2e 实测**（tools/ark-e2e.ts）：`data.embedding` 单向量对象、2048 维、每文本一个请求（该端点把整个 input 数组当作一条多模态条目，无法批量）。

**OpenClaw 对应**：OpenClaw memory 的 openai-remote embedding 后端位（v2026.1.15 `src/memory/embeddings.ts`），配置二选一中的远端分支。local GGUF 分支不在本期（见下）。

**接缝**：注册为 `ctx.embeddings`（单实现，第二个实现 load 即 throw）。

**规格**：docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

```yaml
- id: embeddings-ark
  name: '@clawdsh/dsh-embeddings-ark'
  config:
    baseURL: https://ark.cn-beijing.volces.com/api/v3   # 默认
    model: doubao-embedding-vision-251215               # 默认
    # timeoutMs: 30000            # 单次 embed 调用截止
    # maxConcurrentTexts: 4       # 每文本请求并发上限
```

凭据引用固定为 `ARK_API_KEY`；插件配置不接受字面量 key 或其他 ref。每次 `embed` 先经 credentials seam、再经 launch environment 快照解析，因此 key 不会进入 settings、profile YAML、RPC 或 DOM。解析不到 key 时 `embed` fail-loud，绝不静默降级。

`clawdsh-embeddings-ark` namespace 暴露 endpoint、model 与请求调优，重启后生效。凭据值从不缓存，因此凭据替换仍在下次调用生效。

## 设计要点

- **每操作解析凭证**：不缓存 key（credentials seam 铁律），改 `.env` 后无需重挂载即生效；
- **响应校验**：向量非空且全为有限数；**跨调用维度漂移 fail-loud**——服务端静默换模型不得破坏消费端的 cosine 可比性（实测维度 2048，漂移即报错）；
- **Secret-safe 失败**：HTTP response body 与 JSON parser diagnostics 永不向外传播，因为收到 bearer credential 的端点可能原样回显它；失败只暴露固定 provider 文案与 HTTP status；
- **协作取消**：超时 `AbortSignal.timeout(timeoutMs)` 与调用方 signal 合并，工具超时/会话取消直达 HTTP；
- **每文本一个请求，有界并发**：multimodal 端点把整个 input 数组嵌成一条多模态条目，批量不可能——`embed(N)` 跑最多 `maxConcurrentTexts`（默认 4）个在途请求的 worker 池；每个 worker 认领下一个索引，结果按输入序返回，任一失败整体 reject（embeddings seam 契约）。兄弟请求失败时不强制取消在途请求。

## 变更说明

- 0.1.0：首版（文本输入 + 凭证分层 + 响应校验 + 契约测试 8 例，mock fetch）。
- 0.1.0（2026-08-14 真实 e2e 修正）：真实 wire 实测后按 `data.embedding` 单对象/每文本一请求重写解析与调用；移除 `maxBatchTexts`（该端点无法批量）；契约测试 8 例对齐新 wire + tools/ark-e2e.ts 真实闭环（2048 维、语义召回 0.648）。
- 0.2.0：每文本请求有界并发（`maxConcurrentTexts` 默认 4；保序 worker 池、任一失败整体 reject；5 个并发契约测试）。

## Model Experience

### One embedding call

#### What the model sees

The model sees nothing from this provider directly: `embed` results are vectors consumed programmatically (e.g. `@clawdsh/dsh-memory` cosine ranking). Only the consumer's tool result reaches the model.

#### Token effect

The provider contributes no prompt section and makes no model request, so it adds no model-facing tokens of its own.

#### KV Cache effect

No prompt text is produced by this provider, so the prompt prefix and its KV cache are untouched.

## Known Limitations and Deferred Work

- **仅文本输入**：Ark 端点多模态（image_url 输入类型），本期只发 `type: "text"`；图像嵌入留待有消费者时补；
- **无批量**：该端点无法批量（每文本一个请求），大语料召回仍是 N 个请求；有界并发（`maxConcurrentTexts`）摊薄开销，部分失败时在途兄弟请求自然走完（不强制取消）；
- **无本地模型**：OpenClaw 的 local GGUF 分支未移植；离线部署无嵌入能力（对应 memory 无检索）；
- **调优重启生效**：base URL、model、timeout 与 concurrency 来自启动时设置快照；只有凭据修改在下次调用生效。
