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
})

/**
 * Volcano Ark text-embedding backend. One implementation per context (the
 * `embeddings` service contract); a second load throws at mount. The wire is
 * the multimodal endpoint's real shape (verified against the live API on
 * 2026-08-14): one `data.embedding` object per request, 2048 dimensions, and
 * one text per request — the endpoint embeds the whole input array as ONE
 * multimodal item, so the provider sends one request per text in input order.
 * Every response is validated (finite non-empty vector) and cross-call
 * dimension drift fails the call, so a silent model upgrade cannot corrupt
 * cosine ranking in consumers.
 */
export class ArkEmbeddings extends Embeddings {
  static Config: z<Config> = Config

  private readonly baseURL: string
  private readonly model: string
  private readonly timeoutMs: number
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
    // The multimodal endpoint embeds one input array as ONE multimodal item, so
    // batching is impossible with this model: one request per text, in order.
    const vectors: EmbeddingVector[] = []
    for (const text of texts) {
      vectors.push(await this.embedOne(text, apiKey, signal))
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

  /** Embed one text and validate its response. */
  private async embedOne(text: string, apiKey: string, signal?: AbortSignal): Promise<EmbeddingVector> {
    const response = await fetch(`${this.baseURL}/embeddings/multimodal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [{ type: 'text', text }],
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
    const vector = parseResponse(payload)
    if (this.firstDimension === undefined) {
      this.firstDimension = vector.length
    } else if (vector.length !== this.firstDimension) {
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: embedding dimension drifted from ${this.firstDimension} to ${vector.length} ` +
        '(model changed server-side?); refusing to mix incompatible vectors',
      )
    }
    return vector
  }
}

/**
 * Validate an Ark embedding response: the multimodal endpoint answers with a
 * single `data.embedding` object holding one non-empty vector of finite numbers.
 * @param payload - the parsed JSON body.
 * @returns the validated vector.
 */
function parseResponse(payload: unknown): EmbeddingVector {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: malformed embedding response (no data field)')
  }
  const data = (payload as { data: unknown }).data
  if (typeof data !== 'object' || data === null || !('embedding' in data)
    || !Array.isArray((data as { embedding: unknown }).embedding)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: malformed embedding response (no data.embedding vector)')
  }
  const embedding = (data as { embedding: unknown[] }).embedding
  if (embedding.length === 0 || !embedding.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('@clawdsh/dsh-embeddings-ark: invalid embedding vector (empty or non-finite entries)')
  }
  return embedding as number[]
}

export default ArkEmbeddings
