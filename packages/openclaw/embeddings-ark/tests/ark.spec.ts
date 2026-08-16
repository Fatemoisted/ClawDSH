/**
 * Contract tests for the Ark embeddings provider, keyless: the HTTP layer is mocked with
 * `vi.stubGlobal('fetch', …)` and credentials come from `ARK_API_KEY` or a stub credentials
 * provider — no real endpoint is contacted. Pinned against the wire shape verified with the
 * live API on 2026-08-14: the multimodal endpoint answers with one `data.embedding` object
 * per request and embeds one text per request, so the provider issues one request per text
 * in input order. Also pinned: request shape (endpoint, Bearer header, text-only input),
 * response validation (finite non-empty vector), cross-call dimension drift, and
 * fail-loud credential handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ARK_SETTINGS_NAMESPACE, ArkEmbeddings } from '@clawdsh/dsh-embeddings-ark'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly store: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.store)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.store[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function testContext(store: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TestSettings, store)
  return ctx
}

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

/** Build the live wire's response body: one `data.embedding` vector. */
function responseBody(embedding: readonly number[]): string {
  return JSON.stringify({ data: { embedding } })
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

function requestText(init: RequestInit): string {
  const payload: unknown = JSON.parse(init.body as string)
  if (typeof payload !== 'object' || payload === null || !('input' in payload)) {
    throw new Error('request body has no input')
  }
  const input = payload.input
  if (!Array.isArray(input) || input.length !== 1) throw new Error('request body has invalid input')
  const entry: unknown = input[0]
  if (typeof entry !== 'object' || entry === null || !('text' in entry)
    || typeof entry.text !== 'string') {
    throw new Error('request body has no text input')
  }
  return entry.text
}

function requestSignal(init: RequestInit): AbortSignal {
  if (init.signal === undefined || init.signal === null) throw new Error('request has no AbortSignal')
  return init.signal
}

beforeEach(() => {
  vi.stubEnv('ARK_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ark embeddings provider', () => {
  it('declares Settings as a required class plugin dependency', () => {
    expect(ArkEmbeddings.inject).toEqual(['settings'])
  })

  it('uses endpoint settings from the startup snapshot while credentials stay next-call', async () => {
    const fetchMock = okFetch(responseBody([0.1]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext({
      'clawdsh-embeddings-ark': { baseURL: 'https://settings.example/v3', model: 'settings-model' },
    })
    await ctx.plugin(ArkEmbeddings, { model: 'base-model' })
    await ctx.embeddings.embed(['a'])
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://settings.example/v3/embeddings/multimodal')
    expect(JSON.parse(firstFetchInit(fetchMock).body as string)).toMatchObject({ model: 'settings-model' })
    expect(ctx.settings.describe().find(entry => entry.ns === ARK_SETTINGS_NAMESPACE))
      .toMatchObject({ applies: 'restart' })

    await ctx.settings.update(ARK_SETTINGS_NAMESPACE, { model: 'changed-model' })
    vi.stubEnv('ARK_API_KEY', 'rotated-key')
    await ctx.embeddings.embed(['b'])
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toMatchObject({ model: 'settings-model' })
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer rotated-key' })
    await ctx.fiber.dispose()
  })

  it('normalizes a trailing base URL slash before appending the Ark endpoint', async () => {
    const fetchMock = okFetch(responseBody([0.1]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { baseURL: 'https://ark.example/api/v3/' })

    await ctx.embeddings.embed(['a'])

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://ark.example/api/v3/embeddings/multimodal')
  })

  it('rejects unusable endpoint and model settings at mount without exposing URL credentials', async () => {
    await expect((await testContext()).plugin(ArkEmbeddings, { model: '   ' }))
      .rejects.toThrow(/model.*non-empty/)
    await expect((await testContext()).plugin(ArkEmbeddings, { baseURL: 'relative/path' }))
      .rejects.toThrow(/absolute HTTP\(S\) URL/)
    let failure: unknown
    try {
      await (await testContext()).plugin(ArkEmbeddings, {
        baseURL: 'https://ark-url-secret@example.test/api/v3',
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain('ark-url-secret')
  })

  it('sends one text-only request per text and parses vectors in order', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const text = requestText(init)
      return new Response(responseBody(text === '天很蓝' ? [0.1, 0.2] : [0.3, 0.4]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    const vectors = await ctx.embeddings.embed(['天很蓝', '海很深'])
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]
    if (first === undefined) throw new Error('fetch was never called')
    const [url, init] = first
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'doubao-embedding-vision-251215',
      input: [{ type: 'text', text: '天很蓝' }],
    })
  })

  it('throws on a response without a data.embedding vector', async () => {
    vi.stubGlobal('fetch', okFetch(JSON.stringify({ data: { object: 'embedding' } })))
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    await expect(ctx.embeddings.embed(['a'])).rejects.toThrow(/data\.embedding/)
  })

  it('throws on an empty or non-finite embedding vector', async () => {
    vi.stubGlobal('fetch', okFetch(JSON.stringify({ data: { embedding: [0.1, Number.NaN] } })))
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    await expect(ctx.embeddings.embed(['a'])).rejects.toThrow(/invalid embedding vector/)
  })

  it('throws when the dimension drifts across calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(responseBody([0.1, 0.2]), { status: 200 }))
      .mockResolvedValueOnce(new Response(responseBody([0.1, 0.2, 0.3]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    await ctx.embeddings.embed(['a'])
    await expect(ctx.embeddings.embed(['b'])).rejects.toThrow(/drifted/)
  })

  it('throws on a non-2xx response', async () => {
    const secret = 'ark-secret-response-canary'
    vi.stubEnv('ARK_API_KEY', secret)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(secret, { status: 401 })))
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    const failure = await ctx.embeddings.embed(['a']).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/HTTP 401/)
    expect(String(failure)).not.toContain(secret)
  })

  it('does not propagate a secret echoed in a malformed successful response', async () => {
    const secret = 'ark-secret-json-canary'
    vi.stubEnv('ARK_API_KEY', secret)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(secret, { status: 200 })))
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    const failure = await ctx.embeddings.embed(['a']).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/malformed JSON embedding response/)
    expect(String(failure)).not.toContain(secret)
  })

  it('fails loudly when no key is resolvable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('ARK_API_KEY', '')
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    await expect(ctx.embeddings.embed(['a'])).rejects.toThrow(/no API key resolved/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves the fixed ARK_API_KEY reference from the launch environment', async () => {
    vi.stubEnv('ARK_API_KEY', 'env-key')
    const fetchMock = okFetch(responseBody([0.1]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, {})
    await ctx.embeddings.embed(['a'])
    expect(firstFetchInit(fetchMock).headers).toMatchObject({ Authorization: 'Bearer env-key' })
  })

  it('resolves the fixed ARK_API_KEY reference through the credentials seam', async () => {
    const fetchMock = okFetch(responseBody([0.1]))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(StubCredentials)
    await ctx.plugin(ArkEmbeddings, {})
    await ctx.embeddings.embed(['a'])
    expect(firstFetchInit(fetchMock).headers).toMatchObject({ Authorization: 'Bearer stub-key-ARK_API_KEY' })
  })

  it('caps in-flight requests at maxConcurrentTexts and completes the full batch', async () => {
    let openGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => { openGate = resolve })
    let inFlight = 0
    let peak = 0
    const fetchMock = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await gate
      inFlight -= 1
      return new Response(responseBody([0.1]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 4 })
    const embedding = ctx.embeddings.embed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(4) })
    expect(peak).toBe(4)
    openGate()
    const vectors = await embedding
    expect(vectors).toHaveLength(10)
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(peak).toBe(4)
  })

  it('uses one operation signal and deadline across serial request waves', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(requestSignal(init))
      return new Response(responseBody([0.1]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 1 })

    await ctx.embeddings.embed(['a', 'b', 'c'])

    expect(signals).toHaveLength(3)
    expect(signals[1]).toBe(signals[0])
    expect(signals[2]).toBe(signals[0])
  })

  it('aborts and drains started siblings before reporting the first batch failure', async () => {
    const started: string[] = []
    let slowAborted = false
    let releaseSlow = (): void => {}
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const text = requestText(init)
      started.push(text)
      if (text === 'bad') return new Response('failure', { status: 500 })
      if (text !== 'slow') return new Response(responseBody([0.1]), { status: 200 })
      return await new Promise<Response>((resolve, reject) => {
        releaseSlow = () => { resolve(new Response(responseBody([0.1]), { status: 200 })) }
        const operationSignal = requestSignal(init)
        operationSignal.addEventListener('abort', () => {
          slowAborted = true
          reject(operationSignal.reason instanceof Error
            ? operationSignal.reason
            : new Error('embedding operation aborted'))
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 2 })
    try {
      await expect(ctx.embeddings.embed(['bad', 'slow', 'must-not-start']))
        .rejects.toThrow(/HTTP 500/)
      expect(slowAborted).toBe(true)
      expect(started).toEqual(['bad', 'slow'])
    } finally {
      releaseSlow()
    }
  })

  it('returns vectors in input order even when requests resolve out of order', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const text = requestText(init)
      const index = Number(text)
      // The first request is the slowest; completion order is the reverse of input order.
      await new Promise(resolve => setTimeout(resolve, (10 - index) * 2))
      return new Response(responseBody([index]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 4 })
    const texts = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
    const vectors = await ctx.embeddings.embed(texts)
    expect(vectors).toEqual([[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]])
  })

  it('rejects the whole batch when one request fails', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const text = requestText(init)
      if (text === 'bad') return new Response('boom', { status: 500 })
      return new Response(responseBody([0.1]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 4 })
    await expect(ctx.embeddings.embed(['a', 'b', 'bad', 'c', 'd', 'e'])).rejects.toThrow(/HTTP 500/)
  })

  it('runs strictly serially with maxConcurrentTexts 1', async () => {
    let openGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => { openGate = resolve })
    let inFlight = 0
    let peak = 0
    const fetchMock = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await gate
      inFlight -= 1
      return new Response(responseBody([0.1]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await testContext()
    await ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 1 })
    const embedding = ctx.embeddings.embed(['a', 'b', 'c'])
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    expect(peak).toBe(1)
    openGate()
    await embedding
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(peak).toBe(1)
  })

  it('rejects maxConcurrentTexts below 1 at mount', async () => {
    const ctx = await testContext()
    await expect(ctx.plugin(ArkEmbeddings, { maxConcurrentTexts: 0 })).rejects.toThrow()
  })
})
