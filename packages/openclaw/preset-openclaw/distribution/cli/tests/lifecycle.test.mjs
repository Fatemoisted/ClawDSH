import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { defaultDshRunner } from '../lib/index.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  signals = []

  kill(signal) {
    this.signals.push(signal)
    return true
  }
}

class FakeHost extends EventEmitter {
  execPath = '/exact/node'
  environment = { INHERITED: 'yes', DSH_HOME: '/old/home' }
  selfSignals = []

  onSignal(signal, listener) {
    this.on(signal, listener)
  }

  offSignal(signal, listener) {
    this.off(signal, listener)
  }

  signalSelf(signal) {
    this.selfSignals.push(signal)
  }
}

function createRun(child, host, inspectSpawn = () => {}) {
  return defaultDshRunner({
    binary: '/exact/dsh.mjs',
    profile: 'clawdsh',
    forwarded: ['--port', '8080'],
    home: '/managed/home',
  }, {
    host,
    spawnChild(command, args, options) {
      inspectSpawn(command, args, options)
      return child
    },
  })
}

function assertSignalListenersRemoved(host) {
  assert.equal(host.listenerCount('SIGINT'), 0)
  assert.equal(host.listenerCount('SIGTERM'), 0)
  assert.equal(host.listenerCount('SIGHUP'), 0)
}

test('spawns dsh asynchronously with inherited stdio and the managed home', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  const run = createRun(child, host, (command, args, options) => {
    assert.equal(command, '/exact/node')
    assert.deepEqual(args, ['/exact/dsh.mjs', '--profile', 'clawdsh', '--port', '8080'])
    assert.equal(options.stdio, 'inherit')
    assert.deepEqual(options.env, { INHERITED: 'yes', DSH_HOME: '/managed/home' })
  })

  child.emit('close', 17, null)

  assert.equal(await run, 17)
  assert.deepEqual(host.selfSignals, [])
  assertSignalListenersRemoved(host)
})

test('forwards wrapper signals and restores signal disposition before mirroring termination', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  const run = createRun(child, host)

  host.emit('SIGTERM')
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(host.listenerCount('SIGTERM'), 1)

  child.emit('close', 0, null)

  assert.equal(await run, 1)
  assert.deepEqual(host.selfSignals, ['SIGTERM'])
  assertSignalListenersRemoved(host)
})

test('forwards every supported signal while preserving the first wrapper termination signal', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  const run = createRun(child, host)

  host.emit('SIGHUP')
  host.emit('SIGINT')
  child.emit('close', null, 'SIGINT')

  assert.equal(await run, 1)
  assert.deepEqual(child.signals, ['SIGHUP', 'SIGINT'])
  assert.deepEqual(host.selfSignals, ['SIGHUP'])
  assertSignalListenersRemoved(host)
})

test('mirrors a child signal even when the wrapper did not receive one', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  const run = createRun(child, host)

  child.signalCode = 'SIGINT'
  child.emit('close', null, 'SIGINT')

  assert.equal(await run, 1)
  assert.deepEqual(host.selfSignals, ['SIGINT'])
  assertSignalListenersRemoved(host)
})

test('rejects spawn errors and removes every process listener', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  const run = createRun(child, host)
  const failure = new Error('spawn failed')

  child.emit('error', failure)

  await assert.rejects(run, error => error === failure)
  assertSignalListenersRemoved(host)
  assert.equal(child.listenerCount('close'), 0)
})

test('rejects signal forwarding failures without retaining listeners', async () => {
  const child = new FakeChild()
  child.kill = () => { throw new Error('kill failed') }
  const host = new FakeHost()
  const run = createRun(child, host)

  host.emit('SIGTERM')

  await assert.rejects(run, /kill failed/)
  assertSignalListenersRemoved(host)
  assert.equal(child.listenerCount('close'), 0)
})

test('rejects a false signal-forward result instead of waiting indefinitely', async () => {
  const child = new FakeChild()
  child.kill = () => false
  const host = new FakeHost()
  const run = createRun(child, host)

  host.emit('SIGHUP')

  await assert.rejects(run, /failed to forward SIGHUP to dsh/)
  assertSignalListenersRemoved(host)
  assert.equal(child.listenerCount('close'), 0)
})

test('rejects self-signal failures after the child has fully closed', async () => {
  const child = new FakeChild()
  const host = new FakeHost()
  host.signalSelf = () => { throw new Error('self signal failed') }
  const run = createRun(child, host)

  child.emit('close', null, 'SIGHUP')

  await assert.rejects(run, /self signal failed/)
  assertSignalListenersRemoved(host)
})
