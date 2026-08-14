# @clawdsh/dsh-embeddings-ark

**定位**：`@clawdsh/dsh-embeddings` seam 的第一个 provider——火山方舟（Volcano Ark）文本嵌入。POST Ark 的 OpenAI 兼容多模态端点 `/embeddings/multimodal`，只发 `type: "text"` 输入；wire format 与原生 `fetch` 客户端是 provider 私有实现，不走 `ctx.llm`（dsh 的 LLM seam 没有 embedding 端点）。

**OpenClaw 对应**：OpenClaw memory 的 openai-remote embedding 后端位（v2026.1.15 `src/memory/embeddings.ts`），配置二选一中的远端分支。local GGUF 分支不在本期（见下）。

**接缝**：注册为 `ctx.embeddings`（单实现，第二个实现 load 即 throw）。

**规格**：docs/adr/0003-embeddings-seam.md · **状态**：implemented

## 使用

```yaml
- id: embeddings-ark
  name: '@clawdsh/dsh-embeddings-ark'
  config:
    apiKeyEnv: ARK_API_KEY        # 默认值；经 credentials seam 每操作解析
    # apiKey: 也可直接给字面量（不推荐——secret 会进配置面）
    baseURL: https://ark.cn-beijing.volces.com/api/v3   # 默认
    model: doubao-embedding-vision-251215               # 默认
    # timeoutMs: 30000            # 单次 embed 调用截止
    # maxBatchTexts: 32           # 超批自动串行分片
```

凭证分层（继承 dsh credentials seam）：config `apiKey` 字面量 → credentials seam（env 环境变量 / `$DSH_HOME/.credentials.yaml` / 项目 `.env` / `$DSH_HOME/.env`）→ launch environment 环境快照。**API Key 永不入仓库**：放根 `.env`（`ARK_API_KEY=...`，已 gitignore）。解析不到 key 时 `embed` fail-loud，绝不静默降级。

## 设计要点

- **每操作解析凭证**：不缓存 key（credentials seam 铁律），改 `.env` 后无需重挂载即生效；
- **响应校验**：条目数 == 输入数、向量非空且全为有限数、批内维度一致；**跨调用维度漂移 fail-loud**——服务端静默换模型不得破坏消费端的 cosine 可比性；
- **协作取消**：超时 `AbortSignal.timeout(timeoutMs)` 与调用方 signal 合并，工具超时/会话取消直达 HTTP；
- **分片**：超过 `maxBatchTexts` 的输入串行分片，消费端无批量上限概念。

## 变更说明

- 0.1.0：首版（文本输入 + 凭证分层 + 响应校验 + 分片；契约测试 8 例，mock fetch）。

## Model Experience

### One embedding call

#### What the model sees

None directly — `embed` results are vectors consumed programmatically (e.g. `@clawdsh/dsh-memory` cosine ranking). Only the consumer's tool result reaches the model.

#### Token effect

None: no prompt section, no model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **仅文本输入**：Ark 端点多模态（image_url 输入类型），本期只发 `type: "text"`；图像嵌入留待有消费者时补；
- **wire shape 未经真实 e2e**：契约测试按 OpenAI 兼容响应 mock；真实凭证 e2e 留阶段 3（解析失败会 fail-loud，不会静默错误）；
- **无本地模型**：OpenClaw 的 local GGUF 分支未移植；离线部署无嵌入能力（对应 memory 无检索）；
- **无 settings 集成**：baseURL/model 改动用 patch + 重挂载，无运行时 settings 节（`web-search-deepseek` 有，后续按需对齐）。
