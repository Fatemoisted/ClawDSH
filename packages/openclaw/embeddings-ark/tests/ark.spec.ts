/**
 * Contract tests for the Ark embeddings provider, keyless: the HTTP layer is mocked with
 * `vi.stubGlobal('fetch', …)` and credentials come from literal config or a stub credentials
 * provider — no real endpoint is contacted. Pinned: request shape (endpoint, Bearer header,
 * text-only multimodal body), response validation (entry count, finite vectors, batch and
 * cross-call dimension consistency), fail-loud credential handling, and batch sharding.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { ArkEmbeddings } from '@clawdsh/dsh-embeddings-ark'

/** Minimal credentials backend: always resolves to one fixed value. */
class StubCredentials extends CredentialProvider {
  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    return { value: `stub-key-${String(ref)}`, source: 'stub' }
  }

  async describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return { configured: true, source: 'stub', writable: false }
  }

  async set(_ref: CredentialRef, _value: string): Promise<void> {}
  async unset(_ref: CredentialRef): Promise<void> {}
}

/** Build an OpenAI-compatible response body with the given vectors. */
function responseBody(vectors: readonly (readonly number[])[]): string {
  return JSON.stringify({ data: vectors.map(embedding => ({ embedding })) })
}

function okFetch(body: string): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(body, { status: 200 }))
}

/** The init of the first fetch call, or a hard failure when fetch never ran. */
function firstFetchInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const first = fetchMock.mock.calls[0]
  if (first === undefined) throw new Error('fetch was never called')
  return first[1] as RequestInit
}

const NO_SUCH_ENV = 'CLAWDSH_TEST_NO_SUCH_KEY_ENV'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ark embeddings provider', () => {
  it('posts text-only inputs to the multimodal endpoint with a Bearer header and parses vectors', async () => {
    const fetchMock = okFetch(responseBody([[0.1, 0.2], [0.3, 0.4]]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key' })
    const vectors = await ctx.embeddings.embed(['天很蓝', '海很深'])
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]])
    const first = fetchMock.mock.calls[0]
    if (first === undefined) throw new Error('fetch was never called')
    const [url, init] = first
    expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      model: 'doubao-embedding-vision-251215',
      input: [{ type: 'text', text: '天很蓝' }, { type: 'text', text: '海很深' }],
    })
  })

  it('throws when the response entry count does not match the input count', async () => {
    vi.stubGlobal('fetch', okFetch(responseBody([[0.1, 0.2]])))
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key' })
    await expect(ctx.embeddings.embed(['a', 'b'])).rejects.toThrow(/entries/)
  })

  it('throws on inconsistent dimensions within one response', async () => {
    vi.stubGlobal('fetch', okFetch(responseBody([[0.1, 0.2], [0.3]])))
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key' })
    await expect(ctx.embeddings.embed(['a', 'b'])).rejects.toThrow(/dimension/)
  })

  it('throws when the dimension drifts across calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(responseBody([[0.1, 0.2]]), { status: 200 }))
      .mockResolvedValueOnce(new Response(responseBody([[0.1, 0.2, 0.3]]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key' })
    await ctx.embeddings.embed(['a'])
    await expect(ctx.embeddings.embed(['b'])).rejects.toThrow(/drifted/)
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 401 })))
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key' })
    await expect(ctx.embeddings.embed(['a'])).rejects.toThrow(/HTTP 401/)
  })

  it('fails loudly when no key is resolvable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKeyEnv: NO_SUCH_ENV })
    await expect(ctx.embeddings.embed(['a'])).rejects.toThrow(/no API key resolved/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefers the literal apiKey over the environment', async () => {
    vi.stubEnv('ARK_API_KEY', 'env-key')
    const fetchMock = okFetch(responseBody([[0.1]]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'literal-key' })
    await ctx.embeddings.embed(['a'])
    expect(firstFetchInit(fetchMock).headers).toMatchObject({ Authorization: 'Bearer literal-key' })
  })

  it('resolves the key through the credentials seam for a custom reference', async () => {
    const fetchMock = okFetch(responseBody([[0.1]]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(StubCredentials)
    await ctx.plugin(ArkEmbeddings, { apiKeyEnv: 'MY_CUSTOM_KEY' })
    await ctx.embeddings.embed(['a'])
    expect(firstFetchInit(fetchMock).headers).toMatchObject({ Authorization: 'Bearer stub-key-MY_CUSTOM_KEY' })
  })

  it('shards oversized inputs across sequential requests', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const count = (JSON.parse(init.body as string).input as unknown[]).length
      return new Response(responseBody(Array.from({ length: count }, () => [0.1])), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(ArkEmbeddings, { apiKey: 'test-key', maxBatchTexts: 2 })
    const vectors = await ctx.embeddings.embed(['a', 'b', 'c', 'd', 'e'])
    expect(vectors).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
