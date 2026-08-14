/**
 * Tests for the embeddings Service Definition: a minimal concrete subclass registers as
 * `ctx.embeddings`, a second load throws (duplicate service), disposal releases
 * the service, and reading the service without a backend returns `undefined`
 * (optional-service access rule). Embedding quality is the provider's concern
 * (`@clawdsh/dsh-embeddings-ark`); here we only pin the seam contract.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Embeddings } from '@clawdsh/dsh-embeddings'
import type { EmbeddingVector } from '@clawdsh/dsh-embeddings'

/** Minimal concrete backend: returns one deterministic vector per text, in order. */
class StubEmbeddings extends Embeddings {
  calls = 0

  async embed(texts: readonly string[], _signal?: AbortSignal): Promise<EmbeddingVector[]> {
    this.calls += 1
    return texts.map(text => [text.length, text.codePointAt(0) ?? 0])
  }
}

describe('embeddings seam', () => {
  it('registers as ctx.embeddings and embeds texts in order', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEmbeddings)
    const vectors = await ctx.embeddings.embed(['hi', 'hello'])
    expect(vectors).toEqual([[2, 104], [5, 104]])
    expect((ctx.embeddings as StubEmbeddings).calls).toBe(1)
  })

  it('rejects a second implementation (one per context)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEmbeddings)
    await expect(ctx.plugin(StubEmbeddings)).rejects.toThrow()
  })

  it('releases the service on disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubEmbeddings)
    expect(ctx.embeddings).toBeInstanceOf(StubEmbeddings)
    await fiber.dispose()
    expect((ctx as Context & { embeddings?: unknown }).embeddings).toBeUndefined()
  })

  it('reads undefined through ctx.get when no backend is loaded', () => {
    const ctx = new Context()
    expect(ctx.get('embeddings')).toBeUndefined()
  })
})
