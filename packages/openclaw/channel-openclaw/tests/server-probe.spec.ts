import { type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  connectMode: 'timeout' as 'timeout' | 'unexpected-error' | 'double',
  failListen: false,
}))

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>()
  return {
    ...actual,
    connect: vi.fn(() => {
      const socket = new actual.Socket()
      if (probe.connectMode === 'unexpected-error') {
        queueMicrotask(() => {
          socket.emit('error', Object.assign(new Error('probe denied'), { code: 'EACCES' }))
        })
      } else if (probe.connectMode === 'double') {
        queueMicrotask(() => {
          socket.emit('error', Object.assign(new Error('stale'), { code: 'ECONNREFUSED' }))
          socket.emit('connect')
        })
      }
      return socket
    }),
    createServer: vi.fn((listener?: (socket: Socket) => void) => {
      const server = actual.createServer(listener)
      if (probe.failListen) {
        Reflect.set(server, 'listen', () => {
          queueMicrotask(() => { server.emit('error', new Error('asynchronous listen failure')) })
          return server
        })
      }
      return server
    }),
  }
})

import { createServer, type Server } from 'node:net'
import { lstat } from 'node:fs/promises'
import { OpenClawChannelProvider } from '../src/server.ts'
import { providerConfig, providerContext, removeProviderRoot } from './provider-fixtures.ts'

const roots: string[] = []
const servers: Server[] = []
const providers: OpenClawChannelProvider[] = []

afterEach(async () => {
  probe.connectMode = 'timeout'
  probe.failListen = false
  await Promise.allSettled(providers.splice(0).map(async (provider) => { await provider.dispose() }))
  await Promise.allSettled(servers.splice(0).map(async (server) => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }))
  await Promise.allSettled(roots.splice(0).map(removeProviderRoot))
})

async function occupiedEndpoint(): Promise<Awaited<ReturnType<typeof providerConfig>>> {
  const fixture = await providerConfig({ handshakeTimeoutMs: 5 })
  roots.push(fixture.root)
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(fixture.config.endpoint, resolve)
  })
  return fixture
}

describe('existing IPC endpoint probe failures', () => {
  it('rejects an endpoint whose liveness probe reaches its deadline', async () => {
    const fixture = await occupiedEndpoint()
    const context = providerContext()
    await expect(OpenClawChannelProvider.create(context.ctx, fixture.config)).rejects.toThrow(/probe timed out/)
    expect((await lstat(fixture.config.endpoint)).isSocket()).toBe(true)
    expect(context.media.closes).toBe(1)
  })

  it('rejects unexpected socket errors without unlinking the endpoint', async () => {
    probe.connectMode = 'unexpected-error'
    const fixture = await occupiedEndpoint()
    const context = providerContext()
    await expect(OpenClawChannelProvider.create(context.ctx, fixture.config)).rejects.toThrow(/probe denied/)
    expect((await lstat(fixture.config.endpoint)).isSocket()).toBe(true)
    expect(context.media.closes).toBe(1)
  })

  it('settles a stale probe once even if a later socket event arrives', async () => {
    probe.connectMode = 'double'
    const fixture = await occupiedEndpoint()
    const provider = await OpenClawChannelProvider.create(providerContext().ctx, fixture.config)
    providers.push(provider)
    expect((await lstat(fixture.config.endpoint)).isSocket()).toBe(true)
  })

  it('surfaces an asynchronous listener error and releases storage', async () => {
    const fixture = await providerConfig()
    roots.push(fixture.root)
    probe.failListen = true
    const context = providerContext()
    await expect(OpenClawChannelProvider.create(context.ctx, fixture.config)).rejects.toThrow(/asynchronous listen failure/)
    expect(context.media.closes).toBe(1)
  })
})
