# @clawdsh/dsh-embeddings-ark

English | [中文](README.zh.md)

**Positioning**: the first provider of the `@clawdsh/dsh-embeddings` seam — Volcano Ark text embedding. POSTs Ark's multimodal endpoint `/embeddings/multimodal`, sending only `type: "text"` input; the wire format and the native `fetch` client are provider-private, not going through `ctx.llm` (dsh's LLM seam has no embedding endpoint). **The wire shape is verified against real e2e as of 2026-08-14** (tools/ark-e2e.ts): `data.embedding` is a single-vector object, 2048 dims, one request per text (that endpoint treats the whole input array as one multimodal item and cannot batch).

**OpenClaw counterpart**: the openai-remote embedding backend slot of OpenClaw memory (v2026.1.15 `src/memory/embeddings.ts`), the remote branch of the one-of-two config. The local GGUF branch is out of scope this cycle (see below).

**Seam**: registers as `ctx.embeddings` (single implementation, a second implementation throws on load).

**Spec**: docs/adr/0003-embeddings-seam.md · **Status**: implemented

## Usage

```yaml
- id: embeddings-ark
  name: '@clawdsh/dsh-embeddings-ark'
  config:
    apiKeyEnv: ARK_API_KEY        # 默认值；经 credentials seam 每操作解析
    # apiKey: 也可直接给字面量（不推荐——secret 会进配置面）
    baseURL: https://ark.cn-beijing.volces.com/api/v3   # 默认
    model: doubao-embedding-vision-251215               # 默认
    # timeoutMs: 30000            # 单次 embed 调用截止
    # maxConcurrentTexts: 4       # 每文本请求并发上限
```

Credential layering (inheriting the dsh credentials seam): config `apiKey` literal → credentials seam (env variables / `$DSH_HOME/.credentials.yaml` / project `.env` / `$DSH_HOME/.env`) → launch environment snapshot. **The API key never enters the repo**: put it in the root `.env` (`ARK_API_KEY=...`, already gitignored). When no key resolves, `embed` fails loud, never silently degrades.

## Design notes

- **Resolve credentials per operation**: never cache the key (credentials seam rule); a `.env` change takes effect without a remount;
- **Response validation**: vectors non-empty and all finite; **cross-call dimension drift fails loud** — the server silently swapping models must not break the consumer's cosine comparability (measured 2048 dims; drift errors);
- **Cooperative cancellation**: `AbortSignal.timeout(timeoutMs)` merged with the caller's signal, so tool timeout / session cancellation reaches HTTP directly;
- **One request per text, bounded concurrency**: the multimodal endpoint embeds the whole input array as one multimodal item, batching is impossible — `embed(N)` runs a worker pool of at most `maxConcurrentTexts` (default 4) in-flight requests; each worker claims the next index, so results return in input order, and any failure rejects the whole call (the embeddings seam contract). In-flight requests are not force-cancelled on a sibling failure.

## Changelog

- 0.1.0: first release (text input + credential layering + response validation + 8 contract tests, mock fetch).
- 0.1.0 (2026-08-14 real-e2e correction): after real-wire testing, rewrote parsing and calls around `data.embedding` single-object / one-request-per-text; removed `maxBatchTexts` (the endpoint cannot batch); 8 contract tests aligned to the new wire + tools/ark-e2e.ts real loop (2048 dims, semantic recall 0.648).
- 0.2.0: bounded per-text request concurrency (`maxConcurrentTexts`, default 4; order-preserving worker pool, whole-batch reject on any failure; 5 concurrency contract tests).

## Model Experience

### One embedding call

#### What the model sees

The model sees nothing from this provider directly: `embed` results are vectors consumed programmatically (e.g. `@clawdsh/dsh-memory` cosine ranking). Only the consumer's tool result reaches the model.

#### Token effect

The provider contributes no prompt section and makes no model request, so it adds no model-facing tokens of its own.

#### KV Cache effect

No prompt text is produced by this provider, so the prompt prefix and its KV cache are untouched.

## Known Limitations and Deferred Work

- **Text input only**: the Ark endpoint is multimodal (image_url input type), this cycle only sends `type: "text"`; image embedding is deferred until a consumer needs it;
- **No batching**: the endpoint cannot batch (one request per text), so large-corpus recall stays N requests; bounded concurrency (`maxConcurrentTexts`) amortizes it, and a partial-failure run leaves its in-flight siblings to settle (no force-cancel);
- **No local model**: OpenClaw's local GGUF branch is not ported; offline deployment has no embedding capability (matching memory's no retrieval);
- **No settings integration**: baseURL/model changes use patch + remount, no runtime settings section (`web-search-deepseek` has one; align later as needed).
