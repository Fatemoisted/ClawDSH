/**
 * Service Definition for the text-embedding capability seam (`ctx.embeddings`): an abstract service defining WHAT an
 * embedding backend does — map texts to dense vectors in one comparable embedding space — without
 * saying HOW. Implementations subclass {@link Embeddings} and register as the
 * `embeddings` service; `@clawdsh/dsh-embeddings-ark` (Volcano Ark) is the first.
 *
 * The seam is deliberately minimal: one `embed` method and nothing else. It owns NO
 * chunking, indexing, or similarity ranking (that is the `@clawdsh/dsh-memory`
 * consumer), NO credential storage (that is `@deepseek-ai/dsh-credentials`), and
 * NO model or provider registry: one implementation per context, because mixing
 * providers within one context would break the single comparable embedding
 * space that cosine ranking depends on.
 *
 * @module @clawdsh/dsh-embeddings
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { EmbeddingVector } from './types.ts'

export type { EmbeddingVector } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    embeddings: Embeddings
  }
}

/**
 * Abstract text-embedding service. Subclass, implement {@link embed}, and load
 * the subclass as a plugin — it registers as `ctx.embeddings` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior).
 *
 * Semantics every implementation must honor:
 * - {@link embed} returns exactly one vector per input text, in input order,
 *   and all vectors of one call share one dimension. Providers may additionally
 *   promise dimension stability across calls; the Ark provider does and fails
 *   loudly on drift.
 * - Every vector is a non-empty list of finite numbers.
 * - Any failure — missing credential, network error, malformed or partial
 *   response — rejects the whole call; implementations never return partial
 *   results.
 * - The `signal` cancels the call where the backend can honor it (network
 *   round-trips); cooperative tool timeouts pass their deadline through it.
 */
export abstract class Embeddings extends Service {
  constructor(ctx: Context) {
    super(ctx, 'embeddings')
  }

  /**
   * Embed each input text into one dense vector in the provider's embedding space.
   * @param texts - the texts to embed; empty input embeds to an empty result.
   * @param signal - optional cancellation signal for the underlying request.
   * @returns one {@link EmbeddingVector} per input text, in input order.
   */
  abstract embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbeddingVector[]>
}

export default Embeddings
