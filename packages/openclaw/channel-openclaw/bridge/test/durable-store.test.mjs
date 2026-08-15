import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLazySyncKeyedStore } from '../shared/durable-store.js'

test('external plugin state stays lazy and persists through the private fallback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdsh-state-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  let openCalls = 0
  let resolveCalls = 0
  const api = {
    runtime: {
      state: {
        openSyncKeyedStore() {
          openCalls += 1
          throw new Error('openKeyedStore is only available for trusted plugins in this release.')
        },
        resolveStateDir() {
          resolveCalls += 1
          return directory
        },
      },
    },
  }
  const options = { namespace: 'clawdsh-bridge-test-v1', maxEntries: 2, overflowPolicy: 'reject-new' }
  const first = createLazySyncKeyedStore(api, options)
  assert.equal(openCalls, 0)
  assert.equal(resolveCalls, 0)

  const keyA = 'a'.repeat(64)
  const keyB = 'b'.repeat(64)
  const keyC = 'c'.repeat(64)
  assert.equal(first.lookup(keyA), undefined)
  assert.equal(openCalls, 1)
  assert.equal(resolveCalls, 1)
  assert.equal(first.registerIfAbsent(keyA, { generation: 0 }), true)
  assert.equal(first.registerIfAbsent(keyA, { generation: 1 }), false)
  first.register(keyA, { generation: 1 })
  first.register(keyB, { generation: 2 })
  assert.throws(() => first.register(keyC, { generation: 3 }), /entry limit/)

  const reopened = createLazySyncKeyedStore(api, options)
  assert.deepEqual(reopened.lookup(keyA), { generation: 1 })
  assert.deepEqual(reopened.entries().map(entry => entry.key), [keyA, keyB])
  assert.equal(reopened.delete(keyA), true)
  assert.equal(reopened.delete(keyA), false)
})

test('unexpected OpenClaw state failures are not hidden by the fallback', () => {
  const store = createLazySyncKeyedStore({
    runtime: {
      state: {
        openSyncKeyedStore() { throw new Error('database is corrupt') },
        resolveStateDir() { throw new Error('must not run') },
      },
    },
  }, { namespace: 'clawdsh-bridge-test-v1', maxEntries: 1, overflowPolicy: 'reject-new' })
  assert.throws(() => store.lookup('a'.repeat(64)), /database is corrupt/)
})
