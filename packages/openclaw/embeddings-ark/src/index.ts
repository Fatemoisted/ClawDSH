/**
 * `ArkEmbeddings`: the Volcano Ark (火山方舟) text-embedding provider for the
 * `@clawdsh/dsh-embeddings` seam. Embeds texts through Ark's OpenAI-compatible
 * multimodal embeddings endpoint using `type: "text"` inputs only. The wire
 * format and the native `fetch` client are provider-private and do not use
 * `ctx.llm` — dsh's LLM seam has no embedding endpoint.
 *
 * The fixed `ARK_API_KEY` credential reference is resolved per `embed` call
 * (never cached), first through the credentials seam and then through the
 * launch environment. A call without a resolvable key fails
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
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Default endpoint base for Ark embeddings; `/embeddings/multimodal` is appended. */
export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/** Default Ark embedding model (multimodal input space; text-only inputs here). */
export const ARK_DEFAULT_MODEL = 'doubao-embedding-vision-251215'

/** Default credential reference naming this provider's API key. */
export const ARK_DEFAULT_API_KEY_ENV = 'ARK_API_KEY'

/** User-settings namespace for Ark endpoint and request tuning. */
export const ARK_SETTINGS_NAMESPACE = settingsNamespace('clawdsh-embeddings-ark')

/** Default cooperative deadline for one `embed` call. */
export const ARK_DEFAULT_TIMEOUT_MS = 30_000

/** Default maximum in-flight text requests per `embed` call (the endpoint cannot batch). */
export const ARK_DEFAULT_MAX_CONCURRENT_TEXTS = 4

/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Endpoint base; `/embeddings/multimodal` is appended. */
  baseURL?: string
  /** Embedding model name. Defaults to {@link ARK_DEFAULT_MODEL}. */
  model?: string
  /** Deadline in milliseconds for one `embed` call. */
  timeoutMs?: number
  /** Maximum in-flight text requests per `embed` call. Defaults to 4. */
  maxConcurrentTexts?: number
}

function isHttpBaseURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0
      && url.hash.length === 0
  } catch {
    return false
  }
}

const HTTP_BASE_URL_PATTERN = /^https?:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/u
const MODEL_PATTERN = /^\S(?:.*\S)?$/u

function resolveEndpoint(config: ResolvedConfig): { baseURL: string; model: string } {
  const { baseURL, model } = config
  if (!isHttpBaseURL(baseURL)) {
    throw new TypeError('embeddings-ark: baseURL must be an absolute HTTP(S) URL without credentials, query, or fragment')
  }
  return { baseURL: baseURL.replace(/\/+$/u, ''), model }
}

interface ResolvedConfig {
  baseURL: string
  model: string
  timeoutMs: number
  maxConcurrentTexts: number
}

export const Config: z<Config> = z.object({
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().min(1).pattern(HTTP_BASE_URL_PATTERN).default(ARK_DEFAULT_BASE_URL),
  model: z.string().min(1).pattern(MODEL_PATTERN).default(ARK_DEFAULT_MODEL),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(ARK_DEFAULT_TIMEOUT_MS),
  maxConcurrentTexts: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(ARK_DEFAULT_MAX_CONCURRENT_TEXTS),
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
  static inject = ['settings']
  static Config: z<Config> = Config

  private readonly baseURL: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly maxConcurrentTexts: number
  private readonly apiKeyEnv: CredentialRef = credentialRef(ARK_DEFAULT_API_KEY_ENV)
  /** Dimension of the first successful response; later drift fails the call. */
  private firstDimension: number | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const runtimeConfig = ctx.settings.register(ARK_SETTINGS_NAMESPACE, Config, {
      base: config,
      applies: 'restart',
      validate: value => void resolveConfig(value),
    }).get()
    const resolved = resolveConfig(runtimeConfig)
    this.baseURL = resolved.baseURL
    this.model = resolved.model
    this.timeoutMs = resolved.timeoutMs
    this.maxConcurrentTexts = resolved.maxConcurrentTexts
  }

  override async embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return []
    signal?.throwIfAborted()
    const apiKey = await this.resolveApiKey()
    signal?.throwIfAborted()
    if (apiKey === undefined) {
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: no API key resolved for ${String(this.apiKeyEnv)} ` +
        '(configure ARK_API_KEY through the credentials seam or launch environment)',
      )
    }
    // The multimodal endpoint embeds one input array as ONE multimodal item, so
    // batching is impossible with this model: one request per text. A bounded
    // worker pool runs up to maxConcurrentTexts requests at once; each worker
    // claims the next index, so results land in input order. One operation-wide
    // deadline covers every wave. The first failure aborts siblings, stops new
    // claims, and is rethrown only after all started fetches settle.
    const results = new Array<EmbeddingVector>(texts.length)
    const siblingAbort = new AbortController()
    const deadline = AbortSignal.timeout(this.timeoutMs)
    const operationSignal = signal === undefined
      ? AbortSignal.any([deadline, siblingAbort.signal])
      : AbortSignal.any([deadline, siblingAbort.signal, signal])
    let next = 0
    const state: { failure?: { error: unknown } } = {}
    const workers = Array.from({ length: Math.min(this.maxConcurrentTexts, texts.length) }, async () => {
      while (true) {
        try {
          operationSignal.throwIfAborted()
          const index = next
          next += 1
          if (index >= texts.length) return
          // The Embeddings.embed typed contract and the bounds check above make this indexed access safe.
          const text = texts[index] as string
          results[index] = await this.embedOne(text, apiKey, operationSignal)
        } catch (error: unknown) {
          if (state.failure === undefined) {
            state.failure = { error }
            siblingAbort.abort(error)
          }
          return
        }
      }
    })
    await Promise.all(workers)
    if (state.failure !== undefined) throw state.failure.error
    return results
  }

  /**
   * Resolve `ARK_API_KEY` for one operation through the credentials seam,
   * then the launch environment as the ambient credential plane. Per-operation
   * resolution keeps credential changes effective without
   * a remount, per the credentials seam contract.
   * @returns the resolved key, or `undefined` when no plane carries one.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    const resolved = credentials === undefined ? undefined : await credentials.resolve(this.apiKeyEnv)
    if (resolved !== undefined && resolved.value.length > 0) return resolved.value
    const ambient = launchEnvironmentOf(this.ctx).get(String(this.apiKeyEnv))
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }

  /** Embed one text and validate its response. */
  private async embedOne(text: string, apiKey: string, signal: AbortSignal): Promise<EmbeddingVector> {
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
      signal,
    })
    if (!response.ok) {
      throw new Error(
        `@clawdsh/dsh-embeddings-ark: embedding request failed with HTTP ${response.status}`,
      )
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      // The remote response is attacker-controlled and may echo the bearer
      // credential. Never propagate parser diagnostics derived from its body.
      throw new Error('@clawdsh/dsh-embeddings-ark: malformed JSON embedding response')
    }
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

function resolveConfig(config: Config): ResolvedConfig {
  const parsed = Config(config) as ResolvedConfig
  const { baseURL, model } = resolveEndpoint(parsed)
  const { timeoutMs, maxConcurrentTexts } = parsed
  return { baseURL, model, timeoutMs, maxConcurrentTexts }
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
  const data = payload.data
  if (typeof data !== 'object' || data === null || !('embedding' in data)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: malformed embedding response (no data.embedding vector)')
  }
  const embedding: unknown = data.embedding
  if (!Array.isArray(embedding)) {
    throw new Error('@clawdsh/dsh-embeddings-ark: malformed embedding response (no data.embedding vector)')
  }
  if (embedding.length === 0) {
    throw new Error('@clawdsh/dsh-embeddings-ark: invalid embedding vector (empty or non-finite entries)')
  }
  const vector: number[] = []
  for (const value of embedding) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('@clawdsh/dsh-embeddings-ark: invalid embedding vector (empty or non-finite entries)')
    }
    vector.push(value)
  }
  return vector
}

export default ArkEmbeddings
