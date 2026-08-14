/**
 * `ArkEmbeddings`: the Volcano Ark (火山方舟) text-embedding provider for the
 * `@clawdsh/dsh-embeddings` seam. Embeds texts through Ark's OpenAI-compatible
 * multimodal embeddings endpoint using `type: "text"` inputs only. The wire
 * format and the native `fetch` client are provider-private and do not use
 * `ctx.llm` — dsh's LLM seam has no embedding endpoint.
 *
 * The API key is resolved per `embed` call (never cached): literal
 * `config.apiKey` wins, then the credentials seam (`@deepseek-ai/dsh-credentials`),
 * then the launch environment — the same layering as
 * `@deepseek-ai/dsh-web-search-deepseek`. A call without a resolvable key fails
 * loudly; the provider never silently degrades.
 *
 * @module @clawdsh/dsh-embeddings-ark
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@clawdsh/dsh-embeddings'
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Default endpoint base for Ark embeddings; `/embeddings/multimodal` is appended. */
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Default Ark embedding model (multimodal input space; text-only inputs here). */
export const ARK_DEFAULT_MODEL = 'doubao-embedding-vision-251215'

/** Default credential reference naming this provider's API key. */
export const ARK_DEFAULT_API_KEY_ENV = 'ARK_API_KEY'

/** Default cooperative deadline for one `embed` call. */
export const ARK_DEFAULT_TIMEOUT_MS = 30_000

/** Default maximum texts per HTTP request; larger inputs are sharded serially. */
export const ARK_DEFAULT_MAX_BATCH_TEXTS = 32

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Literal Ark API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved per embed; defaults to `ARK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/embeddings/multimodal` is appended. */
  baseURL?: string
  /** Embedding model name. Defaults to {@link ARK_DEFAULT_MODEL}. */
  model?: string
  /** Deadline in milliseconds for one `embed` call. */
  timeoutMs?: number
  /** Maximum texts per HTTP request; larger inputs are sharded serially. */
  maxBatchTexts?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(ARK_DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().default(ARK_DEFAULT_BASE_URL),
  model: z.string().default(ARK_DEFAULT_MODEL),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(ARK_DEFAULT_TIMEOUT_MS),
  maxBatchTexts: z.number().step(1).min(1).default(ARK_DEFAULT_MAX_BATCH_TEXTS),
})

/**
 * Volcano Ark text-embedding backend. One implementation per context (the
 * `embeddings` service contract); a second load throws at mount. The provider
 * validates every response (entry count, finite non-empty vectors, batch and
 * cross-call dimension consistency) and rejects the whole call on any
 * mismatch — a dimension drift from a silent model upgrade must not corrupt
 * cosine ranking in consumers.
 */
export class ArkEmbeddings extends Embeddings {
  static Config: z<Config> = Config

  private readonly baseURL: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxBatchTexts: number
  /** Literal key when configured; otherwise resolved per embed via credentials/env. */
  private readonly apiKey: string | undefined
  private readonly apiKeyEnv: CredentialRef
  /** Dimension of the first successful response; later drift fails the call. */
  private firstDimension: number | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.baseURL = config.baseURL ?? ARK_DEFAULT_BASE_URL
    this.model = config.model ?? ARK_DEFAULT_MODEL
    this.timeoutMs = config.timeoutMs ?? ARK_DEFAULT_TIMEOUT_MS
    this.maxBatchTexts = config.maxBatchTexts ?? ARK_DEFAULT_MAX_BATCH_TEXTS
    this.apiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
    this.apiKeyEnv = credentialRef(config.apiKeyEnv ?? ARK_DEFAULT_API_KEY_ENV)
  }

  override async embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]> {
    const apiKey = this.apiKey ?? await this.resolveApiKey()
    if (apiKey === undefined) {
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: no API key resolved for ${String(this.apiKeyEnv)} ` +
        '(set config apiKey, or provide the key through the credentials seam / launch environment)',
      )
    }
    const vectors: EmbeddingVector[] = []
    for (let start = 0; start < texts.length; start += this.maxBatchTexts) {
      const batch = texts.slice(start, start + this.maxBatchTexts)
      vectors.push(...await this.embedBatch(batch, apiKey, signal))
    }
    return vectors
  }

  /**
   * Resolve the API key for one operation. Literal config wins; then the
   * credentials seam; then the launch environment as the ambient credential
   * plane. Per-operation resolution keeps credential changes effective without
   * a remount, per the credentials seam contract.
   * @returns the resolved key, or `undefined` when no plane carries one.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(this.apiKeyEnv))?.value
    const ambient = launchEnvironmentOf(this.ctx).get(String(this.apiKeyEnv))
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }

  /** Embed one shard and validate its response. */
  private async embedBatch(batch: readonly string[], apiKey: string, signal?: AbortSignal): Promise<EmbeddingVector[]> {
    const response = await fetch(`${this.baseURL}/embeddings/multimodal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: batch.map(text => ({ type: 'text', text })),
      }),
      signal: signal === undefined
        ? AbortSignal.timeout(this.timeoutMs)
        : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal]),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: embedding request failed with HTTP ${response.status}: ${body.slice(0, 200)}`,
      )
    }
    const payload: unknown = await response.json()
    const { vectors, dimension } = parseResponse(payload, batch.length)
    if (this.firstDimension === undefined) {
      this.firstDimension = dimension
    } else if (dimension !== this.firstDimension) {
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: embedding dimension drifted from ${this.firstDimension} to ${dimension} ` +
        '(model changed server-side?); refusing to mix incompatible vectors',
      )
    }
    return vectors
  }
}

/** A validated embedding response: the vectors in order plus their shared dimension. */
interface ParsedEmbeddings {
  vectors: EmbeddingVector[]
  dimension: number
}

/**
 * Validate an Ark embedding response against the seam contract: exactly one
 * entry per input, each a non-empty list of finite numbers, all of one dimension.
 * @param payload - the parsed JSON body.
 * @param expectedCount - the number of inputs the request sent.
 * @returns the validated vectors in response order plus their shared dimension.
 */
function parseResponse(payload: unknown, expectedCount: number): ParsedEmbeddings {
  if (expectedCount === 0) return { vectors: [], dimension: 0 }
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: malformed embedding response (no data field)')
  }
  const data = (payload as { data: unknown }).data
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(
      `@clawdsh/dsh-embeddings-ark: embedding response has ${Array.isArray(data) ? data.length : 'no'} entries ` +
      `for ${expectedCount} inputs`,
    )
  }
  const vectors = data.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || !('embedding' in entry)
      || !Array.isArray((entry as { embedding: unknown }).embedding)) {
      throw new Error(`@clawdsh/dsh-embeddings-ark: malformed embedding entry at index ${index}`)
    }
    const embedding = (entry as { embedding: unknown[] }).embedding
    if (embedding.length === 0 || !embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`@clawdsh/dsh-embeddings-ark: invalid embedding vector at index ${index}`)
    }
    return embedding as number[]
  })
  const first = vectors[0]
  if (first === undefined) {
    // Unreachable: expectedCount > 0 above guarantees a non-empty `data`.
    throw new Error('@clawdsh/dsh-embeddings-ark: empty embedding response for a non-empty input')
  }
  const dimension = first.length
  if (!vectors.every(vector => vector.length === dimension)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: inconsistent embedding dimensions within one response')
  }
  return { vectors, dimension }
}

export default ArkEmbeddings
