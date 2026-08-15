import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
} from '../../shared/src/protocol.ts'
import { apply, internals } from '../src/index.ts'

interface CapturedResponse {
  response: ServerResponse
  status: number | undefined
  headers: Record<string, string> | undefined
  body: string | undefined
}

function captureResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    response: undefined as unknown as ServerResponse,
    status: undefined,
    headers: undefined,
    body: undefined,
  }
  captured.response = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status
      captured.headers = headers
      return this
    },
    end(body?: string | Buffer) {
      captured.body = body === undefined ? '' : body.toString()
      return this
    },
  } as unknown as ServerResponse
  return captured
}

function request(url: string, method = 'GET'): IncomingMessage {
  return { url, method } as IncomingMessage
}

function entry(
  id: string,
  moduleName: string,
  state: number | undefined,
  disabled = false,
  group = false,
): Entry {
  return {
    id: `root/${id}`,
    disabled,
    options: { id, name: moduleName, group },
    ...state === undefined ? {} : { fiber: { state } },
  } as unknown as Entry
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClawDSH product runtime projections', () => {
  it('classifies Loader rows separately from channel support evidence', () => {
    const response = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 2),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', undefined, true),
      entry('platform', '@deepseek-ai/dsh-session', 3),
      entry('community', '@community/example', 1),
    ], 'active')

    expect(response.loaderInventory.map(item => [item.localId, item.source, item.state])).toEqual([
      ['channel', 'clawdsh', 'active'],
      ['channel-agent', 'clawdsh', 'active'],
      ['channel-openclaw', 'clawdsh', 'disabled'],
      ['platform', 'platform', 'failed'],
      ['community', 'community', 'starting'],
    ])
    const channels = response.capabilities.find(item => item.id === 'channels')
    expect(channels?.state).toBe('disabled')
    expect(channels?.channels).toHaveLength(27)
    expect(new Set(channels?.channels?.map(item => item.support))).toEqual(new Set(['cataloged']))
    expect(channels?.components.map(item => item.label)).toEqual([
      'Channel Protocol',
      'Agent Bridge',
      'OpenClaw Gateway Provider',
    ])
    expect(response.capabilities.some(item => item.id === 'activity')).toBe(true)
    const soul = response.capabilities.find(item => item.id === 'soul')
    expect(soul).toMatchObject({ state: 'active', components: [{ stateSource: 'preset', loaderEntries: [] }] })
    expect(channels?.dependencies).toEqual(['Channel Protocol', 'Agent Bridge'])
    expect(response.capabilities.find(item => item.id === 'memory')?.dependencies).toEqual(['Ark Embeddings'])
  })

  it('lets a required Channel component failure override an active Gateway provider', () => {
    const response = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 3),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
    ], 'disabled')

    const channels = response.capabilities.find(item => item.id === 'channels')
    expect(channels?.components.find(component => component.id === 'openclaw-gateway-provider')?.state).toBe('active')
    expect(channels?.state).toBe('failed')
  })

  it('reports absent required Channel children as disabled under the disabled parent group', () => {
    const response = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', undefined, true, true),
    ], 'active')
    const channels = response.capabilities.find(item => item.id === 'channels')

    expect(channels?.state).toBe('disabled')
    expect(channels?.components.map(component => component.state)).toEqual([
      'disabled',
      'disabled',
      'disabled',
    ])
  })

  it('recognizes only the enabled managed Soul row in a preset composition', () => {
    expect(internals.hasManagedSoul("- id: soul\n  name: '@clawdsh/dsh-soul'\n")).toBe(true)
    expect(internals.hasManagedSoul("- id: soul\n  name: '@clawdsh/dsh-soul'\n  disabled: true\n")).toBe(false)
    expect(internals.hasManagedSoul("- id: soul\n  name: '@community/soul'\n")).toBe(false)
    expect(internals.hasManagedSoul('not: [valid')).toBe(false)
  })

  it('rejects decoded traversal and malformed paths before static serving', () => {
    expect(internals.assetPath('/clawdsh/settings')).toEqual({ ok: true, path: '/settings' })
    expect(internals.assetPath('/clawdsh/%2e%2e%2fsecret')).toEqual({ ok: false, status: 403 })
    expect(internals.assetPath('/clawdsh/a%5cb')).toEqual({ ok: false, status: 403 })
    expect(internals.assetPath('/clawdsh/%zz')).toEqual({ ok: false, status: 400 })
  })
})

describe('ClawDSH product routes', () => {
  it('redirects canonically and applies Host index transforms to SPA fallbacks', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-product-routes-'))
    const index = join(temporary, 'index.html')
    writeFileSync(index, '<main>shell</main>')
    const routes: WebRoute[] = []
    const ctx = {
      webServer: {
        register(route: WebRoute) {
          routes.push(route)
          return () => undefined
        },
        applyIndexTaps(html: string) {
          return html.replace('</main>', '<i>boot</i></main>')
        },
      },
      effect(factory: () => unknown) {
        factory()
        return () => undefined
      },
    } as unknown as Context

    try {
      internals.registerProductRoutes(ctx, index)
      const redirect = routes.find(route => route.kind === 'exact')
      const staticRoute = routes.find(route => route.kind === 'prefix')
      expect(redirect?.path).toBe('/clawdsh')
      expect(staticRoute?.path).toBe('/clawdsh')

      const redirected = captureResponse()
      await redirect?.handler(request('/clawdsh?from=test'), redirected.response)
      expect(redirected.status).toBe(308)
      expect(redirected.headers).toEqual({ location: '/clawdsh/?from=test' })

      const rejectedMethod = captureResponse()
      await staticRoute?.handler(request('/clawdsh/settings', 'POST'), rejectedMethod.response)
      expect(rejectedMethod.status).toBe(405)

      const traversal = captureResponse()
      await staticRoute?.handler(request('/clawdsh/%2e%2e%2fsecret'), traversal.response)
      expect(traversal.status).toBe(403)

      const spa = captureResponse()
      await staticRoute?.handler(request('/clawdsh/settings'), spa.response)
      expect(spa.status).toBe(200)
      expect(spa.body).toBe('<main>shell<i>boot</i></main>')
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})

describe('ClawDSH control channel and readiness', () => {
  it('registers loopback-only RPC and prints only after Loader settlement', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-product-runtime-'))
    const index = join(temporary, 'index.html')
    writeFileSync(index, '<main>shell</main>')
    const previousResolver = internals.resolveDistIndex
    internals.resolveDistIndex = () => index
    let settle!: () => void
    const settled = new Promise<void>((resolve) => { settle = resolve })
    let handler: ConnectionRpcHandler | undefined
    let authority: string | undefined
    const disposers: Array<() => void | Promise<void>> = []
    const webServer = {
      port: 4567,
      register: () => () => undefined,
      applyIndexTaps: (html: string) => html,
    }
    const ctx = {
      webServer,
      connection: {
        rpc: {
          handle(channel: string, next: ConnectionRpcHandler, options: { authority: string }) {
            expect(channel).toBe(CLAWDSH_RPC_CHANNEL)
            handler = next
            authority = options.authority
            return async () => undefined
          },
        },
      },
      loader: {
        entries: () => [],
        await: () => settled,
      },
      agentPresets: {
        defaultId: 'clawdsh',
        resolve: async () => ({ id: 'clawdsh', trust: 'user', path: '/preset/agent.cordis.yml' }),
      },
      effect(factory: () => (() => void | Promise<void>) | void) {
        const disposer = factory()
        if (disposer !== undefined) disposers.push(disposer)
        return disposer
      },
      get(service: string) {
        return service === 'webServer' ? webServer : undefined
      },
    } as unknown as Context
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      apply(ctx)
      expect(authority).toBe('loopback')
      expect(log).not.toHaveBeenCalled()

      const bootstrap = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.bootstrapGet,
        CLAWDSH_READ_REQUEST,
        new AbortController().signal,
      )
      expect(bootstrap).toMatchObject({ ok: true, value: { product: { id: 'clawdsh' } } })
      const invalid = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
        { version: 1, extra: true },
        new AbortController().signal,
      )
      expect(invalid).toMatchObject({ ok: false, error: { code: 'bad-request' } })

      settle()
      await settled
      await Promise.resolve()
      await Promise.resolve()
      expect(log).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('clawdsh web: http://127.0.0.1:4567/clawdsh/')
    } finally {
      internals.resolveDistIndex = previousResolver
      await Promise.all(disposers.map(dispose => dispose()))
      rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('stays silent when Loader settlement fails or teardown wins the race', async () => {
    const run = async (settled: Promise<void>, disposeFirst: boolean): Promise<void> => {
      const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-product-silent-'))
      const index = join(temporary, 'index.html')
      writeFileSync(index, '<main>shell</main>')
      const previousResolver = internals.resolveDistIndex
      internals.resolveDistIndex = () => index
      const disposers: Array<() => void | Promise<void>> = []
      const webServer = { port: 4567, register: () => () => undefined, applyIndexTaps: (html: string) => html }
      const ctx = {
        webServer,
        connection: { rpc: { handle: () => async () => undefined } },
        loader: { entries: () => [], await: () => settled },
        agentPresets: {
          defaultId: 'clawdsh',
          resolve: async () => ({ id: 'clawdsh', trust: 'user', path: '/preset/agent.cordis.yml' }),
        },
        effect(factory: () => (() => void | Promise<void>) | void) {
          const disposer = factory()
          if (disposer !== undefined) disposers.push(disposer)
          return disposer
        },
        get: (service: string) => service === 'webServer' ? webServer : undefined,
      } as unknown as Context
      try {
        apply(ctx)
        if (disposeFirst) await Promise.all(disposers.map(dispose => dispose()))
        await settled.catch(() => undefined)
        await Promise.resolve()
      } finally {
        internals.resolveDistIndex = previousResolver
        rmSync(temporary, { recursive: true, force: true })
      }
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await run(Promise.reject(new Error('boot failed')), false)
    await run(Promise.resolve(), true)
    expect(log).not.toHaveBeenCalled()
  })
})
