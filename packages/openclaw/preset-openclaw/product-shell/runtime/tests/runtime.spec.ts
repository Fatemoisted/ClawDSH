import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_CHANNEL,
  CLAWDSH_RPC_ENDPOINTS,
} from '../../shared/src/protocol.ts'
import { apply, internals } from '../src/index.ts'
import { CREDENTIAL_MANIFEST, SETTINGS_MANIFEST } from '../src/settings-manifest.ts'

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

function controlServices(): { settings: object; credentials: object } {
  const schema = z.object({ enabled: z.const(true).default(true) })
  const activity: {
    ns: string
    schema: unknown
    value: unknown
    revision: number
    base: unknown
    applies: 'restart'
  } = {
    ns: 'clawdsh-activity',
    schema: schema.toJSON(),
    value: { enabled: true },
    revision: 0,
    base: { enabled: true },
    applies: 'restart',
  }
  return {
    settings: {
      describe: () => [activity],
    },
    credentials: {},
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClawDSH product runtime projections', () => {
  it('freezes the eight product settings namespaces and sole Ark credential reference', () => {
    expect(SETTINGS_MANIFEST.map(entry => entry.namespace)).toEqual([
      'clawdsh-soul',
      'clawdsh-channel-agent',
      'clawdsh-channel-openclaw',
      'clawdsh-memory',
      'clawdsh-embeddings-ark',
      'clawdsh-skills-hub',
      'clawdsh-automation',
      'clawdsh-activity',
    ])
    expect(CREDENTIAL_MANIFEST).toEqual([{
      id: 'ark-api-key',
      ref: 'ARK_API_KEY',
      label: 'Ark API Key',
      effectTime: 'next-call',
    }])
  })

  it('keeps durable Session workspaces managed while exposing plain-language controls', () => {
    const channelAgent = SETTINGS_MANIFEST.find(entry => entry.namespace === 'clawdsh-channel-agent')
    expect(channelAgent?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['cwd'], access: 'managed', label: '渠道工作目录' }),
      expect.objectContaining({ path: ['shutdownGraceMs'], access: 'editable', label: '关停等待时间' }),
    ]))
    const automation = SETTINGS_MANIFEST.find(entry => entry.namespace === 'clawdsh-automation')
    expect(automation?.effectTime).toBe('live')
    expect(automation?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['enabled'], access: 'editable', label: '启用自动运行' }),
      expect.objectContaining({ path: ['cwd'], access: 'managed', label: '自动任务工作目录' }),
      expect.objectContaining({ path: ['rules'], access: 'editable', label: '自动任务规则' }),
    ]))
  })

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
    expect(response.capabilities.find(item => item.id === 'activity')).toMatchObject({
      required: true,
      state: 'misconfigured',
      components: [{ required: true }],
    })
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
    ], 'disabled', 'active')

    const channels = response.capabilities.find(item => item.id === 'channels')
    expect(channels?.components.find(component => component.id === 'openclaw-gateway-provider')?.state).toBe('active')
    expect(channels?.state).toBe('failed')
  })

  it('does not hide missing or failed required Channel infrastructure behind a disabled Gateway', () => {
    const missing = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
    ], 'active', 'disabled')
    expect(missing.capabilities.find(item => item.id === 'channels')?.state).toBe('misconfigured')

    const failed = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 3),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
    ], 'active', 'disabled')
    expect(failed.capabilities.find(item => item.id === 'channels')?.state).toBe('failed')
  })

  it('keeps Loader composition separate from the disabled Gateway lifecycle', () => {
    const response = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 2),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
    ], 'active', 'disabled')

    const loader = response.loaderInventory.find(item => item.localId === 'channel-openclaw')
    const channels = response.capabilities.find(item => item.id === 'channels')
    expect(loader?.state).toBe('active')
    expect(channels?.state).toBe('disabled')
    expect(channels?.components.find(component => component.id === 'openclaw-gateway-provider')?.state)
      .toBe('disabled')
    expect(new Set(channels?.channels?.map(channel => channel.support))).toEqual(new Set(['cataloged']))
  })

  it('uses captured enablement instead of active Loader Fibers for optional capabilities', () => {
    const response = internals.capabilitiesResponse([
      entry('memory', '@clawdsh/dsh-memory', 2),
      entry('skills-hub', '@clawdsh/dsh-skills-hub', 2),
      entry('automation', '@clawdsh/dsh-automation', 2),
      entry('activity', '@clawdsh/dsh-activity', 2),
    ], 'active', 'disabled', {
      soul: false,
      memory: false,
      skills: false,
      automation: false,
      activity: true,
    })

    expect(response.capabilities.find(item => item.id === 'soul')?.state).toBe('disabled')
    expect(response.capabilities.find(item => item.id === 'memory')?.state).toBe('disabled')
    expect(response.capabilities.find(item => item.id === 'skills')?.state).toBe('disabled')
    expect(response.capabilities.find(item => item.id === 'automation')?.state).toBe('disabled')
    expect(response.capabilities.find(item => item.id === 'activity')?.state).toBe('active')
    expect(response.loaderInventory.every(item => item.state === 'active')).toBe(true)
  })

  it('requires Ark Embeddings before an enabled Memory capability can be active', () => {
    const missing = internals.capabilitiesResponse([
      entry('memory', '@clawdsh/dsh-memory', 2),
    ], 'active', 'disabled')
    const missingMemory = missing.capabilities.find(item => item.id === 'memory')
    expect(missingMemory?.components.find(component => component.id === 'ark-embeddings'))
      .toMatchObject({ required: true, state: 'misconfigured' })
    expect(missingMemory?.state).toBe('misconfigured')

    const failed = internals.capabilitiesResponse([
      entry('memory', '@clawdsh/dsh-memory', 2),
      entry('embeddings-ark', '@clawdsh/dsh-embeddings-ark', 3),
    ], 'active', 'disabled')
    expect(failed.capabilities.find(item => item.id === 'memory')?.state).toBe('failed')
  })

  it('accepts only internally consistent Gateway control snapshots', async () => {
    const stateFor = (snapshot: unknown): Promise<string> => internals.openClawGatewayState({
      get: (name: string) => name === 'clawdshOpenClawControl' ? { snapshot: () => snapshot } : undefined,
    } as unknown as Context)

    await expect(stateFor({ enabled: false, state: 'disabled' })).resolves.toBe('disabled')
    await expect(stateFor({ enabled: true, state: 'starting' })).resolves.toBe('starting')
    await expect(stateFor({ enabled: true, state: 'active' })).resolves.toBe('active')
    await expect(stateFor({ enabled: true, state: 'failed' })).resolves.toBe('failed')
    await expect(stateFor({ enabled: false, state: 'active' })).resolves.toBe('misconfigured')
    await expect(stateFor({ enabled: false, state: 'failed' })).resolves.toBe('misconfigured')
    await expect(stateFor({ enabled: true, state: 'certified' })).resolves.toBe('misconfigured')
  })

  it('projects live Automation settings and authenticated Channel health without account identities', async () => {
    const health = vi.fn(async () => ({
      status: 'ready',
      handshake: { gatewayInstanceId: 'private-gateway-id' },
      accounts: [
        { channel: 'feishu', account: 'private-account-id', status: 'ready' },
        { channel: 'telegram', account: 'private-account-id-2', status: 'degraded' },
      ],
    }))
    const channelRuntime = await internals.channelRuntimeEvidence({
      get: (name: string) => name === 'channels' ? { health } : undefined,
    } as unknown as Context)
    expect(channelRuntime).toEqual({
      status: 'ready',
      bridgeAuthenticated: true,
      accounts: [
        { channel: 'feishu', status: 'ready' },
        { channel: 'telegram', status: 'degraded' },
      ],
    })
    expect(JSON.stringify(channelRuntime)).not.toContain('private-')

    const response = internals.capabilitiesResponse([
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 2),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
      entry('automation', '@clawdsh/dsh-automation', 2),
    ], 'active', 'active', {
      soul: true,
      memory: false,
      skills: false,
      automation: true,
      activity: true,
    }, channelRuntime)
    expect(response.capabilities.find(item => item.id === 'channels')?.channelRuntime).toEqual(channelRuntime)
    expect(response.capabilities.find(item => item.id === 'automation')).toMatchObject({
      effectTime: 'live',
      state: 'active',
    })
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
  it('fails synchronously before route or readiness registration when the product index is unavailable', () => {
    const previousResolver = internals.resolveDistIndex
    internals.resolveDistIndex = () => {
      throw new Error('clawdsh-product-runtime: browser assets are not built')
    }
    const register = vi.fn()
    const handle = vi.fn()
    const awaitLoader = vi.fn()
    const ctx = {
      webServer: { register, applyIndexTaps: (html: string) => html },
      connection: { rpc: { handle } },
      loader: { entries: () => [], await: awaitLoader },
      effect: vi.fn(),
    } as unknown as Context

    try {
      expect(() => apply(ctx)).toThrow('browser assets are not built')
      expect(register).not.toHaveBeenCalled()
      expect(handle).not.toHaveBeenCalled()
      expect(awaitLoader).not.toHaveBeenCalled()
    } finally {
      internals.resolveDistIndex = previousResolver
    }
  })

  it('redirects canonical and legacy paths and applies Host index transforms to SPA fallbacks', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-product-routes-'))
    const index = join(temporary, 'index.html')
    writeFileSync(index, '<main>shell</main>')
    mkdirSync(join(temporary, 'brand'))
    writeFileSync(join(temporary, 'brand/clawdsh-mark-192.png'), 'PNG fixture')
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
      const redirect = routes.find(route => route.kind === 'exact' && route.path === '/clawdsh')
      const settingsRedirect = routes.find(route => route.kind === 'exact' && route.path === '/clawdsh/settings')
      const settingsSlashRedirect = routes.find(route => route.kind === 'exact' && route.path === '/clawdsh/settings/')
      const activityRedirect = routes.find(route => route.kind === 'exact' && route.path === '/clawdsh/activity')
      const activitySlashRedirect = routes.find(route => route.kind === 'exact' && route.path === '/clawdsh/activity/')
      const pngAsset = routes.find(route => (
        route.kind === 'exact' && route.path === '/clawdsh/brand/clawdsh-mark-192.png'
      ))
      const staticRoute = routes.find(route => route.kind === 'prefix')
      expect(redirect?.path).toBe('/clawdsh')
      expect(settingsRedirect?.path).toBe('/clawdsh/settings')
      expect(settingsSlashRedirect?.path).toBe('/clawdsh/settings/')
      expect(activityRedirect?.path).toBe('/clawdsh/activity')
      expect(activitySlashRedirect?.path).toBe('/clawdsh/activity/')
      expect(pngAsset?.path).toBe('/clawdsh/brand/clawdsh-mark-192.png')
      expect(staticRoute?.path).toBe('/clawdsh')

      const redirected = captureResponse()
      await redirect?.handler(request('/clawdsh?from=test'), redirected.response)
      expect(redirected.status).toBe(308)
      expect(redirected.headers).toEqual({ location: '/clawdsh/?from=test' })

      const redirectedSettings = captureResponse()
      await settingsRedirect?.handler(request('/clawdsh/settings?section=memory'), redirectedSettings.response)
      expect(redirectedSettings.status).toBe(308)
      expect(redirectedSettings.headers).toEqual({ location: '/clawdsh/?section=memory' })

      const redirectedActivity = captureResponse()
      await activityRedirect?.handler(request('/clawdsh/activity?kind=memory', 'HEAD'), redirectedActivity.response)
      expect(redirectedActivity.status).toBe(308)
      expect(redirectedActivity.headers).toEqual({ location: '/clawdsh/?kind=memory' })
      expect(redirectedActivity.body).toBe('')

      for (const [legacy, path] of [
        [settingsSlashRedirect, '/clawdsh/settings/?section=soul'],
        [activitySlashRedirect, '/clawdsh/activity/?kind=skill'],
      ] as const) {
        const response = captureResponse()
        await legacy?.handler(request(path), response.response)
        expect(response.status).toBe(308)
        expect(response.headers).toEqual({ location: `/clawdsh/${new URL(path, 'http://clawdsh.invalid').search}` })
      }

      const rejectedMethod = captureResponse()
      await settingsRedirect?.handler(request('/clawdsh/settings', 'POST'), rejectedMethod.response)
      expect(rejectedMethod.status).toBe(405)

      const png = captureResponse()
      await pngAsset?.handler(request('/clawdsh/brand/clawdsh-mark-192.png'), png.response)
      expect(png.status).toBe(200)
      expect(png.headers).toEqual({ 'content-type': 'image/png', 'content-length': '11' })
      expect(png.body).toBe('PNG fixture')

      const pngHead = captureResponse()
      await pngAsset?.handler(request('/clawdsh/brand/clawdsh-mark-192.png', 'HEAD'), pngHead.response)
      expect(pngHead.status).toBe(200)
      expect(pngHead.body).toBe('')

      const traversal = captureResponse()
      await staticRoute?.handler(request('/clawdsh/%2e%2e%2fsecret'), traversal.response)
      expect(traversal.status).toBe(403)

      const spa = captureResponse()
      await staticRoute?.handler(request('/clawdsh/unknown'), spa.response)
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
    const services = controlServices()
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
        if (service === 'webServer') return webServer
        if (service === 'settings') return services.settings
        if (service === 'credentials') return services.credentials
        return undefined
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
      expect(bootstrap).toMatchObject({
        ok: true,
        value: {
          product: { id: 'clawdsh' },
          controlMode: 'local-read-write',
          runtimeState: 'starting',
        },
      })
      const startingCapabilities = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
        CLAWDSH_READ_REQUEST,
        new AbortController().signal,
      )
      expect(startingCapabilities).toMatchObject({
        ok: false,
        error: { code: 'internal', message: 'ClawDSH control is starting; retry shortly' },
      })
      const startingActivity = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.activityList,
        { version: 1, sessionId: 'session-starting' },
        new AbortController().signal,
      )
      expect(startingActivity).toMatchObject({
        ok: false,
        error: { code: 'internal', message: 'ClawDSH control is starting; retry shortly' },
      })
      const invalid = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.capabilitiesList,
        { version: 1, extra: true },
        new AbortController().signal,
      )
      expect(invalid).toMatchObject({ ok: false, error: { code: 'bad-request' } })

      settle()
      await settled
      await vi.waitFor(() => { expect(log).toHaveBeenCalledOnce() })
      expect(log).toHaveBeenCalledWith('clawdsh web: http://127.0.0.1:4567/clawdsh/')
      const readyBootstrap = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.bootstrapGet,
        CLAWDSH_READ_REQUEST,
        new AbortController().signal,
      )
      expect(readyBootstrap).toMatchObject({ ok: true, value: { runtimeState: 'ready' } })
      const activity = await handler?.(
        CLAWDSH_RPC_ENDPOINTS.activityList,
        { version: 1, sessionId: 'session-ready' },
        new AbortController().signal,
      )
      expect(activity).toEqual({
        ok: true,
        value: {
          version: 1,
          records: [],
          availability: { history: 'unavailable', sidecar: 'unavailable' },
          degraded: true,
          warnings: ['activity-history-unavailable', 'activity-data-incomplete'],
        },
      })
    } finally {
      internals.resolveDistIndex = previousResolver
      await Promise.all(disposers.map(dispose => dispose()))
      rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('reads current Soul desire and Gateway health on every capabilities request', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'clawdsh-product-dynamic-capabilities-'))
    const index = join(temporary, 'index.html')
    writeFileSync(index, '<main>shell</main>')
    const previousResolver = internals.resolveDistIndex
    internals.resolveDistIndex = () => index
    const disposers: Array<() => void | Promise<void>> = []
    let handler: ConnectionRpcHandler | undefined
    const soulSchema = z.object({ enabled: z.boolean().default(true) })
    let soulEnabled = true
    let soulRevision = 0
    let soulUser: { enabled: boolean } | undefined
    const activity: {
      ns: string
      schema: unknown
      value: unknown
      revision: number
      base: unknown
      applies: 'restart'
    } = {
      ns: 'clawdsh-activity',
      schema: z.object({ enabled: z.const(true).default(true) }).toJSON(),
      value: { enabled: true },
      revision: 0,
      base: { enabled: true },
      applies: 'restart',
    }
    const settings = {
      describe: vi.fn(() => [{
        ns: 'clawdsh-soul',
        schema: soulSchema.toJSON(),
        value: { enabled: soulEnabled },
        revision: soulRevision,
        base: { enabled: true },
        ...(soulUser === undefined ? {} : { user: soulUser }),
        applies: 'new-session' as const,
      }, activity]),
      mutate: vi.fn(async (
        _ns: unknown,
        operations: Array<{ op: string; path: string[]; value?: unknown }>,
        expected: number,
      ) => {
        expect(expected).toBe(soulRevision)
        expect(operations).toEqual([{ op: 'set', path: ['enabled'], value: false }])
        soulEnabled = false
        soulUser = { enabled: false }
        soulRevision += 1
      }),
      replace: vi.fn(async (_ns: unknown, section: object, expected: number) => {
        expect(expected).toBe(soulRevision)
        expect(section).toEqual({})
        soulEnabled = true
        soulUser = undefined
        soulRevision += 1
      }),
    }
    let gatewaySnapshot: { enabled: boolean; state: 'disabled' | 'failed' } = {
      enabled: false,
      state: 'disabled',
    }
    const snapshot = vi.fn(() => gatewaySnapshot)
    const entries = [
      entry('clawdsh-communication-plane', 'cordis:group', 2, false, true),
      entry('channel', '@clawdsh/dsh-channel', 2),
      entry('channel-agent', '@clawdsh/dsh-channel-agent', 2),
      entry('channel-openclaw', '@clawdsh/dsh-channel-openclaw', 2),
    ]
    const webServer = {
      port: 4568,
      register: () => () => undefined,
      applyIndexTaps: (html: string) => html,
    }
    const agentPresets = {
      defaultId: 'clawdsh',
      resolve: async () => ({ id: 'clawdsh', trust: 'user', path: '/preset/agent.cordis.yml' }),
      read: async () => "- id: soul\n  name: '@clawdsh/dsh-soul'\n",
      standingKeyFor: async () => 'standing-key',
    }
    const ctx = {
      webServer,
      connection: {
        rpc: {
          handle(_channel: string, next: ConnectionRpcHandler) {
            handler = next
            return async () => undefined
          },
        },
      },
      loader: { entries: () => entries, await: async () => undefined },
      effect(factory: () => (() => void | Promise<void>) | void) {
        const disposer = factory()
        if (disposer !== undefined) disposers.push(disposer)
        return disposer
      },
      get(service: string) {
        if (service === 'webServer') return webServer
        if (service === 'settings') return settings
        if (service === 'credentials') return {}
        if (service === 'agentPresets') return agentPresets
        if (service === 'clawdshOpenClawControl') return { snapshot }
        return undefined
      },
    } as unknown as Context
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const call = async (endpoint: string, payload: unknown): Promise<unknown> => handler?.(
      endpoint,
      payload,
      new AbortController().signal,
    )

    try {
      apply(ctx)
      await vi.waitFor(() => { expect(log).toHaveBeenCalledOnce() })
      expect(snapshot).not.toHaveBeenCalled()

      const initial = await call(CLAWDSH_RPC_ENDPOINTS.capabilitiesList, CLAWDSH_READ_REQUEST)
      expect(initial).toMatchObject({
        ok: true,
        value: {
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: 'soul', state: 'active' }),
            expect.objectContaining({ id: 'channels', state: 'disabled' }),
          ]),
        },
      })

      await expect(call(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
        version: 1,
        namespace: 'clawdsh-soul',
        expectedRevision: 0,
        operations: [{ op: 'set', path: ['enabled'], value: false }],
      })).resolves.toMatchObject({ ok: true })
      gatewaySnapshot = { enabled: true, state: 'failed' }
      const changed = await call(CLAWDSH_RPC_ENDPOINTS.capabilitiesList, CLAWDSH_READ_REQUEST)
      expect(changed).toMatchObject({
        ok: true,
        value: {
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: 'soul', state: 'disabled' }),
            expect.objectContaining({ id: 'channels', state: 'failed' }),
          ]),
        },
      })

      await expect(call(CLAWDSH_RPC_ENDPOINTS.settingsReset, {
        version: 1,
        namespace: 'clawdsh-soul',
        expectedRevision: 1,
      })).resolves.toMatchObject({ ok: true })
      const reset = await call(CLAWDSH_RPC_ENDPOINTS.capabilitiesList, CLAWDSH_READ_REQUEST)
      expect(reset).toMatchObject({
        ok: true,
        value: {
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: 'soul', state: 'active' }),
            expect.objectContaining({ id: 'channels', state: 'failed' }),
          ]),
        },
      })
      expect(snapshot).toHaveBeenCalledTimes(3)
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
      const services = controlServices()
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
        get: (service: string) => {
          if (service === 'webServer') return webServer
          if (service === 'settings') return services.settings
          if (service === 'credentials') return services.credentials
          return undefined
        },
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
