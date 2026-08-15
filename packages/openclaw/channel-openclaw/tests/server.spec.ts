import { createServer, type Server } from 'node:net'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { channelActionV1Schema, type ChannelActionV1 } from '@clawdsh/dsh-channel'
import { NdjsonConnection } from '../src/framing.ts'
import { OpenClawChannelProvider } from '../src/server.ts'
import {
  BridgeClient,
  bridgeHandshake,
  cancelRequest,
  closeRequest,
  confirmed,
  providerConfig,
  providerContext,
  removeProviderRoot,
  resetRequest,
  sendAction,
  turn,
  type ProviderMedia,
} from './provider-fixtures.ts'

const providers: OpenClawChannelProvider[] = []
const clients: BridgeClient[] = []
const roots: string[] = []
const extraServers: Server[] = []
const PUBLIC_HANDLER_FAILURE = 'ClawDSH rejected the authenticated bridge request.'

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  await Promise.allSettled(providers.splice(0).map(async (provider) => { await provider.dispose() }))
  await Promise.allSettled(extraServers.splice(0).map(async (server) => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }))
  await Promise.allSettled(roots.splice(0).map(removeProviderRoot))
  vi.restoreAllMocks()
})

async function setup(options: {
  readonly media?: ProviderMedia
  readonly config?: Parameters<typeof providerConfig>[0]
  readonly capabilities?: Parameters<typeof bridgeHandshake>[1]
  readonly authenticate?: boolean
} = {}) {
  const fixture = await providerConfig(options.config)
  roots.push(fixture.root)
  const context = providerContext(options.media)
  const provider = await OpenClawChannelProvider.create(context.ctx, fixture.config)
  providers.push(provider)
  const client = new BridgeClient()
  clients.push(client)
  await client.connect(fixture.config.endpoint)
  if (options.authenticate !== false) {
    await client.authenticate(provider.secrets.token, bridgeHandshake(provider.secrets.startupNonce, options.capabilities))
  }
  return { ...fixture, ...context, provider, client }
}

async function reportDelivery(client: BridgeClient, receipt: Record<string, unknown>): Promise<unknown> {
  return await client.request('delivery.report', {
    protocolVersion: 1, extension: 'delivery.report', receipt,
  })
}

describe('authenticated local Provider lifecycle', () => {
  it('binds a 0600 socket, authenticates the exact lock, and reports local lifecycle state', async () => {
    const app = await setup({ authenticate: false })
    expect((await stat(app.config.endpoint)).mode & 0o777).toBe(0o600)
    expect(await app.provider.health()).toMatchObject({ status: 'starting', accounts: [], diagnostics: [] })
    await app.client.authenticate(
      app.provider.secrets.token,
      bridgeHandshake(app.provider.secrets.startupNonce),
    )
    await expect(app.provider.firstHandshake).resolves.toMatchObject({ gatewayInstanceId: 'gateway-1' })
    app.client.onProviderRequest = () => ({
      protocolVersion: 1,
      status: 'ready',
      checkedAt: '2026-08-16T00:00:00Z',
      accounts: [],
      diagnostics: [],
    })
    await expect(app.provider.health()).resolves.toMatchObject({ status: 'ready' })
    app.provider.beginShutdown()
    app.provider.beginShutdown()
    await expect(app.provider.health()).resolves.toMatchObject({ status: 'ready' })
    const firstDispose = app.provider.dispose()
    expect(app.provider.dispose()).toBe(firstDispose)
    await firstDispose
    expect(app.media.closes).toBe(1)
    await expect(lstat(app.config.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unauthenticated peer without exposing the exact cause, then accepts a valid reconnect', async () => {
    const app = await setup({ authenticate: false })
    app.client.send({ kind: 'handshake', token: 'wrong', handshake: bridgeHandshake(app.provider.secrets.startupNonce) })
    await app.client.waitForClose()
    expect(await app.provider.health()).toMatchObject({
      status: 'degraded', diagnostics: [{ code: 'CHANNEL_GATEWAY', message: 'channel-openclaw: bridge authentication failed' }],
    })

    const valid = new BridgeClient()
    clients.push(valid)
    await valid.connect(app.config.endpoint)
    await valid.authenticate(app.provider.secrets.token, bridgeHandshake(app.provider.secrets.startupNonce))
    await expect(app.provider.firstHandshake).resolves.toMatchObject({ startupNonce: app.provider.secrets.startupNonce })
  })

  it('rejects a lock identity mismatch and a second concurrent peer', async () => {
    const app = await setup({ authenticate: false })
    const wrong = bridgeHandshake(app.provider.secrets.startupNonce)
    ;(wrong.openclaw as Record<string, unknown>).tag = 'wrong'
    app.client.send({ kind: 'handshake', token: app.provider.secrets.token, handshake: wrong })
    await app.client.waitForClose()

    const valid = new BridgeClient()
    clients.push(valid)
    await valid.connect(app.config.endpoint)
    await valid.authenticate(app.provider.secrets.token, bridgeHandshake(app.provider.secrets.startupNonce))
    const extra = new BridgeClient()
    clients.push(extra)
    await extra.connect(app.config.endpoint)
    await extra.waitForClose()
  })

  it('disconnects a peer that never authenticates before the configured deadline', async () => {
    const app = await setup({ authenticate: false, config: { handshakeTimeoutMs: 10 } })
    await app.client.waitForClose()
    expect(await app.provider.health()).toMatchObject({ status: 'degraded' })
  })

  it('ignores a cleared handshake deadline after authentication', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    const app = await setup({ config: { handshakeTimeoutMs: 5 } })
    await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
    expect(await app.provider.health()).toMatchObject({ handshake: { gatewayInstanceId: 'gateway-1' } })
    clear.mockRestore()
  })

  it.each([new Error('ack write failed'), 'ack write failed'])('closes if the handshake acknowledgement cannot be sent', async (failure) => {
    vi.spyOn(NdjsonConnection.prototype, 'send').mockRejectedValueOnce(failure)
    const app = await setup({ authenticate: false })
    app.client.send({
      kind: 'handshake',
      token: app.provider.secrets.token,
      handshake: bridgeHandshake(app.provider.secrets.startupNonce),
    })
    await app.client.waitForClose()
  })

  it('rejects a malformed handshake envelope before token comparison', async () => {
    const app = await setup({ authenticate: false })
    app.client.send({ kind: 'wrong', token: app.provider.secrets.token, handshake: {} })
    await app.client.waitForClose()
  })

  it('fails closed on Windows and closes storage after a bind failure', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValueOnce('win32')
    const windows = await providerConfig()
    roots.push(windows.root)
    await expect(OpenClawChannelProvider.create(providerContext().ctx, windows.config)).rejects.toThrow(/named-pipe ACL/)

    const relative = providerContext()
    await expect(OpenClawChannelProvider.create(relative.ctx, { ...windows.config, endpoint: 'relative.sock' }))
      .rejects.toThrow(/absolute Unix socket/)
    expect(relative.media.closes).toBe(1)
  })

  it('rejects public socket parents and non-socket endpoint collisions', async () => {
    const publicFixture = await providerConfig()
    roots.push(publicFixture.root)
    await chmod(join(publicFixture.root, 'state'), 0o755)
    const publicContext = providerContext()
    await expect(OpenClawChannelProvider.create(publicContext.ctx, publicFixture.config)).rejects.toThrow(/private 0700/)
    expect(publicContext.media.closes).toBe(1)

    const fileFixture = await providerConfig()
    roots.push(fileFixture.root)
    await writeFile(fileFixture.config.endpoint, 'collision')
    const fileContext = providerContext()
    await expect(OpenClawChannelProvider.create(fileContext.ctx, fileFixture.config)).rejects.toThrow(/not a socket/)
    expect(fileContext.media.closes).toBe(1)

    const linkedFixture = await providerConfig()
    roots.push(linkedFixture.root)
    const outside = join(linkedFixture.root, 'outside')
    const linkedParent = join(linkedFixture.root, 'state', 'linked')
    await mkdir(outside)
    await symlink(outside, linkedParent)
    const linkedContext = providerContext()
    await expect(OpenClawChannelProvider.create(linkedContext.ctx, {
      ...linkedFixture.config,
      endpoint: join(linkedParent, 'bridge.sock'),
    })).rejects.toThrow(/private 0700/)
    expect(linkedContext.media.closes).toBe(1)
  })

  it('rejects an active socket without unlinking another Provider endpoint', async () => {
    const activeFixture = await providerConfig()
    roots.push(activeFixture.root)
    const active = createServer()
    extraServers.push(active)
    await new Promise<void>((resolve, reject) => {
      active.once('error', reject)
      active.listen(activeFixture.config.endpoint, resolve)
    })
    const context = providerContext()
    await expect(OpenClawChannelProvider.create(context.ctx, activeFixture.config))
      .rejects.toThrow(/endpoint is already active/)
    expect((await lstat(activeFixture.config.endpoint)).isSocket()).toBe(true)
    expect(context.media.closes).toBe(1)
  })

  it('removes a refused stale socket before binding and surfaces an asynchronous listen failure', async () => {
    const staleFixture = await providerConfig()
    roots.push(staleFixture.root)
    const child = spawn(process.execPath, ['-e', [
      "const net = require('node:net')",
      'const server = net.createServer()',
      "server.listen(process.argv[1], () => process.stdout.write('ready'))",
      'setInterval(() => {}, 1000)',
    ].join(';'), staleFixture.config.endpoint], { stdio: ['ignore', 'pipe', 'ignore'] })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => { reject(new Error(`stale-socket child exited early with ${String(code)}`)) })
        child.stdout.once('data', () => { resolve() })
      })
      const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
      child.kill('SIGKILL')
      await exited
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    const context = providerContext()
    const provider = await OpenClawChannelProvider.create(context.ctx, staleFixture.config)
    providers.push(provider)
    expect((await lstat(staleFixture.config.endpoint)).isSocket()).toBe(true)

    const longFixture = await providerConfig()
    roots.push(longFixture.root)
    const longContext = providerContext()
    await expect(OpenClawChannelProvider.create(longContext.ctx, {
      ...longFixture.config,
      endpoint: join(longFixture.root, 'state', 'x'.repeat(256)),
    })).rejects.toThrow()
    expect(longContext.media.closes).toBe(1)
  })

  it('covers shutdown without an owned listener and exact cleanup failures', async () => {
    const app = await setup({ authenticate: false })
    app.client.close()
    await app.client.waitForClose()
    const owned = Reflect.get(app.provider, 'server') as Server
    Reflect.set(app.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      owned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    app.provider.beginShutdown()
    await app.provider.dispose()

    const failing = await setup({ authenticate: false })
    failing.client.close()
    await failing.client.waitForClose()
    const failingOwned = Reflect.get(failing.provider, 'server') as Server
    Reflect.set(failing.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      failingOwned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    Reflect.set(failing.provider.config, 'endpoint', '\0')
    await expect(failing.provider.dispose()).rejects.toThrow()
    expect(failing.media.closes).toBe(1)
  })

  it('surfaces listener-close failure while still releasing the ledger', async () => {
    const app = await setup({ authenticate: false })
    app.client.close()
    await app.client.waitForClose()
    const owned = Reflect.get(app.provider, 'server') as Server
    Reflect.set(app.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      owned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    Reflect.set(app.provider, 'server', {
      close: (callback: (error?: Error) => void) => { callback(new Error('listener close failed')) },
    })
    const firstDispose = app.provider.dispose()
    expect(app.provider.dispose()).toBe(firstDispose)
    await expect(firstDispose).rejects.toThrow(/listener close failed/)
    expect(app.media.closes).toBe(1)
  })

  it('aggregates independent listener, socket, and ledger cleanup failures', async () => {
    const app = await setup({ authenticate: false })
    app.client.close()
    await app.client.waitForClose()
    const owned = Reflect.get(app.provider, 'server') as Server
    Reflect.set(app.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      owned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    Reflect.set(app.provider, 'server', {
      close: (callback: (error?: Error) => void) => { callback(new Error('listener close failed')) },
    })
    Reflect.set(app.provider.config, 'endpoint', '\0')
    const domain = Reflect.get(app.provider, 'domain') as { close: () => Promise<void> }
    domain.close = async () => { throw new Error('ledger close failed') }
    const disposal = app.provider.dispose()
    await expect(disposal).rejects.toBeInstanceOf(AggregateError)
    await expect(disposal).rejects.toThrow(/Provider cleanup was incomplete/)
  })

  it('removes a socket recreated at the exact endpoint after listener shutdown', async () => {
    const app = await setup({ authenticate: false })
    app.client.close()
    await app.client.waitForClose()
    const owned = Reflect.get(app.provider, 'server') as Server
    Reflect.set(app.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      owned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    const replacement = createServer()
    extraServers.push(replacement)
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject)
      replacement.listen(app.config.endpoint, resolve)
    })
    await app.provider.dispose()
    await expect(lstat(app.config.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves a non-socket replacement untouched during exact cleanup', async () => {
    const app = await setup({ authenticate: false })
    app.client.close()
    await app.client.waitForClose()
    const owned = Reflect.get(app.provider, 'server') as Server
    Reflect.set(app.provider, 'server', undefined)
    await new Promise<void>((resolve, reject) => {
      owned.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await writeFile(app.config.endpoint, 'replacement file')
    await app.provider.dispose()
    expect(await lstat(app.config.endpoint)).toMatchObject({ size: 16 })
  })
})

describe('bridge-to-DSH request routing', () => {
  it('runs turns and routes cancellation, reset, close, health, and negotiated progress', async () => {
    const app = await setup()
    app.channels.runTurn.mockImplementationOnce(async (_request, execution) => {
      const notify = (execution as { notify: (value: Record<string, unknown>) => void }).notify
      notify({ kind: 'text.delta', turnId: 'turn-1', runId: 'run-1', sequence: 0, text: 'r' })
      return {
        protocolVersion: 1,
        turnId: 'turn-1',
        runId: 'run-1',
        replayId: 'replay-1',
        status: 'silent',
        sessionId: 'channel-session-1',
      }
    })
    await expect(app.client.request('turn.run', turn() as never)).resolves.toMatchObject({ status: 'silent' })
    await app.client.waitFor(frame => frame.method === 'turn.progress')
    expect(app.client.notifications).toContainEqual(expect.objectContaining({ method: 'turn.progress' }))

    await expect(app.client.request('turn.cancel', cancelRequest() as never)).resolves.toEqual({})
    await expect(app.client.request('session.reset', resetRequest() as never)).resolves.toMatchObject({ protocolVersion: 1 })
    await expect(app.client.request('session.close', closeRequest() as never)).resolves.toEqual({})
    await expect(app.client.request('health.get', {})).resolves.toMatchObject({ status: 'ready' })
    expect(app.channels.cancel).toHaveBeenCalledOnce()
    expect(app.channels.reset).toHaveBeenCalledOnce()
    expect(app.channels.close).toHaveBeenCalledOnce()
  })

  it('rejects inbound routes for another Gateway instance', async () => {
    const app = await setup()
    const wrongTurn = turn({ route: { ...turn().route, gatewayInstanceId: 'gateway-2' } })
    await expect(app.client.request('turn.run', wrongTurn as never)).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    const reset = resetRequest()
    await expect(app.client.request('session.reset', {
      ...reset, route: { ...reset.route, gatewayInstanceId: 'gateway-2' },
    })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    const close = closeRequest()
    await expect(app.client.request('session.close', {
      ...close, route: { ...close.route, gatewayInstanceId: 'gateway-2' },
    })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
  })

  it('durably records negotiated delivery reports before driver projection', async () => {
    const app = await setup()
    const receipt = {
      protocolVersion: 1,
      deliveryId: 'turn-delivery-1',
      subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
      attempt: 1,
      platformMessageId: 'platform-1',
      status: 'confirmed',
    }
    await expect(app.client.request('delivery.report', {
      protocolVersion: 1, extension: 'delivery.report', receipt,
    })).resolves.toEqual({})
    expect(app.media.deliveries.get('turn-delivery-1')).toMatchObject({ receipt })
    expect(app.channels.reportDelivery).toHaveBeenCalledOnce()
  })

  it('rejects delivery reports that were not negotiated', async () => {
    const app = await setup({ capabilities: { extensions: [] } })
    await expect(app.client.request('delivery.report', {
      protocolVersion: 1,
      extension: 'delivery.report',
      receipt: {
        protocolVersion: 1,
        deliveryId: 'turn-delivery-1',
        subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
        attempt: 1,
        status: 'confirmed',
      },
    })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
  })
})

describe('DSH-to-bridge actions and receipts', () => {
  it('persists a successful mutation and replays it without a second platform request', async () => {
    const app = await setup()
    const action = sendAction()
    await expect(app.provider.action(action)).resolves.toMatchObject({ status: 'confirmed' })
    await expect(app.provider.action(action)).resolves.toMatchObject({ status: 'confirmed' })
    expect(app.client.requests.filter(frame => frame.method === 'channel.action')).toHaveLength(1)
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'completed' })
    expect(app.media.deliveries.get('delivery-action-1')).toMatchObject({ receipt: { status: 'confirmed' } })
  })

  it('rejects unsupported, cross-Gateway, invalid, and outbound-media actions', async () => {
    const app = await setup({ capabilities: { actions: ['send'] } })
    await expect(app.provider.action(sendAction({
      target: { ...sendAction().target, gatewayInstanceId: 'other' },
    })))
      .rejects.toThrow(/another Gateway/)
    const base = sendAction()
    const react = channelActionV1Schema.parse({
      protocolVersion: base.protocolVersion,
      actionId: base.actionId,
      target: base.target,
      kind: 'react',
      messageId: 'message-1',
      reaction: '👍',
      operation: 'add',
    })
    await expect(app.provider.action(react)).rejects.toThrow(/does not support action react/)
    await expect(app.provider.action({ ...sendAction(), text: '', media: [] } as unknown as ChannelActionV1)).rejects.toThrow()
    await expect(app.provider.action(sendAction({
      media: [{
        mediaId: 'media-1', ordinal: 0, kind: 'image', mediaType: 'image/png', bytes: 1,
        sha256: 'a'.repeat(64), relativePath: 'gateway-1/media.png',
      }],
    }))).rejects.toThrow(/staging writer/)
  })

  it('honors pre-aborted actions and rejects actions before or after a bridge connection', async () => {
    const disconnected = await setup({ authenticate: false })
    await expect(disconnected.provider.action(sendAction())).rejects.toThrow(/disconnected/)
    const controller = new AbortController()
    controller.abort(new Error('cancelled before send'))
    await expect(disconnected.provider.action(sendAction(), controller.signal)).rejects.toThrow(/cancelled before send/)

    const reconnected = await setup()
    reconnected.client.close()
    await reconnected.client.waitForClose()
    await vi.waitFor(() => { expect(Reflect.get(reconnected.provider, 'peer')).toBeUndefined() })
    await expect(reconnected.provider.action(sendAction())).rejects.toThrow(/disconnected/)
  })

  it('ledgers every side-effecting action discriminant', async () => {
    const app = await setup()
    const base = sendAction()
    const common = { protocolVersion: 1, target: base.target }
    const actions = [
      { ...common, actionId: 'edit-1', kind: 'edit', messageId: 'message-1', text: 'edited', media: [] },
      { ...common, actionId: 'delete-1', kind: 'delete', messageId: 'message-1' },
      { ...common, actionId: 'react-1', kind: 'react', messageId: 'message-1', reaction: 'ok', operation: 'add' },
      { ...common, actionId: 'poll-1', kind: 'poll', question: 'Choose', options: ['A', 'B'], multiple: false },
      { ...common, actionId: 'typing-1', kind: 'typing', active: true },
    ].map(candidate => channelActionV1Schema.parse(candidate))
    for (const action of actions) await expect(app.provider.action(action)).resolves.toMatchObject({ status: 'confirmed' })
    expect(app.media.actions.size).toBe(actions.length)
  })

  it('rejects action-id conflicts and reconciles uncertain mutations without redispatch', async () => {
    const app = await setup()
    app.client.onProviderRequest = () => { throw new Error('transport uncertainty') }
    const action = sendAction()
    await expect(app.provider.action(action)).rejects.toThrow(/transport uncertainty/)
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
    await expect(app.provider.action(action)).rejects.toThrow(/transport uncertainty/)
    await expect(app.provider.action(sendAction({ text: 'different' }))).rejects.toThrow(/reused with different input/)
    expect(app.client.requests.filter(frame => frame.method === 'channel.action')).toHaveLength(1)
    expect(app.client.requests.filter(frame => frame.method === 'channel.reconcile')).toHaveLength(1)
  })

  it('recovers a bridge-completed receipt from the Provider persistence crash window', async () => {
    const app = await setup()
    const table = Reflect.get(app.provider, 'actions') as {
      put(key: string, value: { readonly phase: string }): Promise<void>
    }
    const persist = table.put.bind(table)
    let failCompletedWrite = true
    table.put = async (key, value) => {
      if (failCompletedWrite && value.phase === 'completed') {
        failCompletedWrite = false
        throw new Error('simulated Provider crash before completed persistence')
      }
      await persist(key, value)
    }

    const action = sendAction()
    await expect(app.provider.action(action)).rejects.toThrow(/simulated Provider crash/)
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
    await expect(app.provider.action(action)).resolves.toMatchObject({ status: 'confirmed' })
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'completed' })
    expect(app.client.requests.map(frame => frame.method)).toEqual(['channel.action', 'channel.reconcile'])
  })

  it('times out only the local action wait and retains uncertain mutations for reconciliation', async () => {
    const app = await setup({ config: { requestTimeoutMs: 10 } })
    app.client.onProviderRequest = () => new Promise(() => {})
    await expect(app.provider.action(sendAction())).rejects.toMatchObject({
      rpcCode: -32002,
      message: 'Gateway RPC request channel.action timed out',
    })
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
    await expect(app.provider.health()).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [{ message: 'Gateway RPC request health.get timed out' }],
    })
  })

  it('rejects a concurrent mutation while its first dispatch is still running', async () => {
    const app = await setup()
    const action = sendAction()
    let release!: () => void
    app.client.onProviderRequest = () => new Promise((resolve) => {
      release = () => { resolve(confirmed(action)) }
    })
    const first = app.provider.action(action)
    await vi.waitFor(() => {
      expect(app.client.requests.filter(frame => frame.method === 'channel.action')).toHaveLength(1)
    })
    await expect(app.provider.action(action)).rejects.toThrow(/already running/)
    release()
    await expect(first).resolves.toMatchObject({ status: 'confirmed' })
  })

  it('fails closed if the bridge disconnects after mutation durability but before dispatch', async () => {
    const app = await setup()
    const table = Reflect.get(app.provider, 'actions') as {
      put(key: string, value: { readonly phase: string }): Promise<void>
    }
    const persist = table.put.bind(table)
    table.put = async (key, value) => {
      await persist(key, value)
      if (value.phase === 'running') Reflect.set(app.provider, 'peer', undefined)
    }
    await expect(app.provider.action(sendAction())).rejects.toThrow(/disconnected/)
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
  })

  it('marks interrupted running mutations as needs-recovery when storage reopens', async () => {
    const fixture = await providerConfig()
    roots.push(fixture.root)
    const action = sendAction()
    const media: ProviderMedia = {
      deliveries: new Map(),
      actions: new Map([['action-1', {
        digest: 'a'.repeat(64), action, phase: 'running', updatedAt: 1,
      }]]),
      closes: 0,
    }
    const context = providerContext(media)
    const provider = await OpenClawChannelProvider.create(context.ctx, fixture.config)
    providers.push(provider)
    expect(media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
  })

  it('leaves already terminal action rows unchanged when storage reopens', async () => {
    const fixture = await providerConfig()
    roots.push(fixture.root)
    const action = sendAction()
    const record = {
      digest: 'a'.repeat(64), action, phase: 'completed', result: confirmed(action), updatedAt: 1,
    }
    const media: ProviderMedia = {
      deliveries: new Map(), actions: new Map([['action-1', record]]), closes: 0,
    }
    const provider = await OpenClawChannelProvider.create(providerContext(media).ctx, fixture.config)
    providers.push(provider)
    expect(media.actions.get('action-1')).toBe(record)
  })

  it('rejects action results for another request and leaves the action recoverable', async () => {
    const app = await setup()
    app.client.onProviderRequest = () => confirmed(sendAction({ actionId: 'other-action' }), {
      deliveryId: 'delivery-other',
    })
    await expect(app.provider.action(sendAction())).rejects.toThrow(/does not match the request/)
    expect(app.media.actions.get('action-1')).toMatchObject({ phase: 'needs-recovery' })
  })

  it('does not ledger read-only directory queries', async () => {
    const app = await setup({ capabilities: { actions: ['directory.self'] } })
    const base = sendAction()
    const action = channelActionV1Schema.parse({
      protocolVersion: base.protocolVersion,
      actionId: base.actionId,
      target: base.target,
      kind: 'directory.self',
    })
    app.client.onProviderRequest = () => ({
      protocolVersion: 1, actionId: action.actionId, kind: 'directory', entries: [],
    })
    await expect(app.provider.action(action)).resolves.toMatchObject({ kind: 'directory' })
    await expect(app.provider.action(action)).resolves.toMatchObject({ kind: 'directory' })
    expect(app.client.requests.filter(frame => frame.method === 'channel.action')).toHaveLength(2)
    expect(app.media.actions.size).toBe(0)
  })

  it('does not create recovery state when a read-only query fails', async () => {
    const app = await setup({ capabilities: { actions: ['directory.self'] } })
    const base = sendAction()
    const action = channelActionV1Schema.parse({
      protocolVersion: 1, actionId: 'directory-failure', target: base.target, kind: 'directory.self',
    })
    app.client.onProviderRequest = () => { throw new Error('directory unavailable') }
    await expect(app.provider.action(action)).rejects.toThrow(/directory unavailable/)
    expect(app.media.actions.size).toBe(0)
  })

  it('degrades health on remote validation failure and after disconnect', async () => {
    const app = await setup()
    app.client.onProviderRequest = () => ({ invalid: true })
    await expect(app.provider.health()).resolves.toMatchObject({
      status: 'degraded', diagnostics: [{ code: 'CHANNEL_GATEWAY' }],
    })
    app.client.close()
    await app.client.waitForClose()
    await expect(app.provider.health()).resolves.toMatchObject({ status: 'degraded', handshake: { gatewayInstanceId: 'gateway-1' } })
  })

  it('ignores closure from a connection that no longer owns the Provider slot', async () => {
    const app = await setup()
    Reflect.set(app.provider, 'connection', { sentinel: true })
    app.client.close()
    await app.client.waitForClose()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(Reflect.get(app.provider, 'connection')).toEqual({ sentinel: true })
    Reflect.set(app.provider, 'connection', undefined)
  })

  it('sanitizes non-Error transport failures in local health', async () => {
    const app = await setup()
    Reflect.set(app.provider, 'peer', { request: async () => { throw 'string failure' } })
    await expect(app.provider.health()).resolves.toMatchObject({
      status: 'degraded', diagnostics: [{ message: 'string failure' }],
    })
  })

  it('gates progress on negotiated notification kinds and ignores send failure', async () => {
    const app = await setup({ capabilities: { notifications: ['status'] } })
    app.provider.notifyProgress({ kind: 'text.delta', turnId: 'turn-1' as never, runId: 'run-1' as never, sequence: 0, text: 'no' })
    expect(app.client.notifications).toHaveLength(0)
    app.client.close()
    app.provider.notifyProgress({ kind: 'status', turnId: 'turn-1' as never, runId: 'run-1' as never, sequence: 0, status: 'running' })
  })

  it('rejects receipt subject reuse, attempt regression, and changes after terminal state', async () => {
    const app = await setup()
    const report = reportDelivery.bind(undefined, app.client)
    const first = {
      protocolVersion: 1,
      deliveryId: 'receipt-1',
      subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
      attempt: 2,
      status: 'accepted',
    }
    await report(first)
    await expect(report({ ...first, subject: { kind: 'turn', turnId: 'turn-2', runId: 'run-2' } }))
      .rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    await expect(report({ ...first, attempt: 1 })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    const terminal = { ...first, attempt: 3, status: 'confirmed' }
    await report(terminal)
    await expect(report(terminal)).resolves.toEqual({})
    await expect(report({ ...terminal, platformMessageId: 'changed' })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)

    for (const [deliveryId, status] of [['ambiguous-1', 'ambiguous'], ['dead-1', 'dead-letter']] as const) {
      const receipt = {
        protocolVersion: 1,
        deliveryId,
        subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
        attempt: 1,
        status,
        error: { code: 'FAILED', message: 'failed', retryable: false },
      }
      await report(receipt)
      await expect(report({ ...receipt, attempt: 2 })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    }
  })

  it('requires retry progress and preserves a learned platform message identity', async () => {
    const app = await setup()
    const report = reportDelivery.bind(undefined, app.client)
    const accepted = {
      protocolVersion: 1,
      deliveryId: 'retry-receipt-1',
      subject: { kind: 'turn', turnId: 'turn-1', runId: 'run-1' },
      attempt: 1,
      platformMessageId: 'platform-1',
      status: 'accepted',
    }
    const retrying = {
      ...accepted,
      status: 'retrying',
      nextAttemptAt: '2026-08-15T12:00:00.000Z',
      error: { code: 'TRANSIENT', message: 'retry later', retryable: true },
    }
    await report(accepted)
    await report(retrying)
    await expect(report({ ...retrying, nextAttemptAt: '2026-08-15T12:01:00.000Z' })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    await expect(report({ ...accepted, attempt: 2 })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    await expect(report({ ...retrying, attempt: 2 })).resolves.toEqual({})
    await expect(report({ ...retrying, attempt: 3, platformMessageId: undefined })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
    await expect(report({ ...retrying, attempt: 3, platformMessageId: 'platform-2' })).rejects.toThrow(PUBLIC_HANDLER_FAILURE)
  })
})
