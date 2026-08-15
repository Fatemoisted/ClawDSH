import { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ChannelFrameError, isObject, NdjsonConnection } from '../src/framing.ts'

class TestDuplex extends Duplex {
  readonly writes: Buffer[] = []
  acceptWrites = true

  override _read(): void {}

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.writes.push(Buffer.from(chunk))
    callback()
  }

  override write(chunk: Uint8Array | string): boolean {
    super.write(chunk)
    return this.acceptWrites
  }

  receive(chunk: Buffer | string): void {
    this.emit('data', chunk)
  }
}

describe('bounded NDJSON framing', () => {
  it('accepts split and batched object frames while replacing the receiver', async () => {
    const stream = new TestDuplex()
    const connection = new NdjsonConnection(stream, 64)
    const first = vi.fn()
    const second = vi.fn()
    connection.onValue(first)
    stream.receive('{"a":')
    stream.receive(Buffer.from('1}\n{"b":2}\n'))
    expect(first).toHaveBeenNthCalledWith(1, { a: 1 })
    expect(first).toHaveBeenNthCalledWith(2, { b: 2 })

    connection.onValue(second)
    stream.receive('{"c":3}\n')
    expect(second).toHaveBeenCalledWith({ c: 3 })
    await connection.send({ reply: true })
    expect(stream.writes.at(-1)?.toString()).toBe('{"reply":true}\n')
    connection.close()
    stream.receive('{}\n')
  })

  it('uses a no-op receiver until the caller installs one', () => {
    const stream = new TestDuplex()
    const connection = new NdjsonConnection(stream, 16)
    expect(() => { stream.receive('{}\n') }).not.toThrow()
    connection.close()
  })

  it.each([
    { name: 'empty frame', bytes: Buffer.from('\n'), message: 'empty channel frame' },
    { name: 'JSON scalar', bytes: Buffer.from('null\n'), message: 'one JSON object' },
    { name: 'JSON array', bytes: Buffer.from('[]\n'), message: 'one JSON object' },
    { name: 'invalid JSON', bytes: Buffer.from('{\n'), message: 'JSON' },
    { name: 'invalid UTF-8', bytes: Buffer.from([0xff, 0x0a]), message: 'encoded data' },
  ])('closes on $name', ({ bytes, message }) => {
    const stream = new TestDuplex()
    const connection = new NdjsonConnection(stream, 32)
    const closed = vi.fn()
    connection.onClose(closed)
    stream.receive(bytes)
    expect(closed).toHaveBeenCalledOnce()
    expect(closed.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(String(closed.mock.calls[0]?.[0])).toMatch(new RegExp(message, 'i'))
  })

  it('closes when a receiver rejects a valid object, including non-Error throws', () => {
    const stream = new TestDuplex()
    const connection = new NdjsonConnection(stream, 32)
    const closed = vi.fn()
    connection.onClose(closed)
    connection.onValue(() => { throw 'receiver failed' })
    stream.receive('{}\n')
    expect(closed.mock.calls[0]?.[0]).toEqual(new ChannelFrameError('receiver failed'))
  })

  it('rejects terminated and unterminated frames above the configured bound', () => {
    for (const frame of ['12345', '12345\n']) {
      const stream = new TestDuplex()
      const connection = new NdjsonConnection(stream, 4)
      const closed = vi.fn()
      connection.onClose(closed)
      stream.receive(frame)
      expect(closed.mock.calls[0]?.[0]).toMatchObject({ code: 'CHANNEL_INVALID_FRAME' })
    }
  })

  it('notifies every close observer exactly once for stream close and error', () => {
    const closeStream = new TestDuplex()
    const closeConnection = new NdjsonConnection(closeStream, 16)
    const closeA = vi.fn()
    const closeB = vi.fn()
    closeConnection.onClose(closeA)
    closeConnection.onClose(closeB)
    closeStream.emit('close')
    closeStream.emit('close')
    expect(closeA).toHaveBeenCalledOnce()
    expect(closeB).toHaveBeenCalledOnce()

    const errorStream = new TestDuplex()
    const errorConnection = new NdjsonConnection(errorStream, 16)
    const failed = vi.fn()
    errorConnection.onClose(failed)
    const error = new Error('stream failed')
    errorStream.emit('error', error)
    expect(failed).toHaveBeenCalledWith(error)
  })

  it('enforces outbound bounds and closed state', async () => {
    const stream = new TestDuplex()
    const connection = new NdjsonConnection(stream, 4)
    await expect(connection.send({ long: true })).rejects.toBeInstanceOf(ChannelFrameError)
    connection.close(new Error('closed intentionally'))
    connection.close()
    await expect(connection.send({})).rejects.toThrow(/closed/)
  })

  it('waits for drain and rejects backpressured writes on error or close', async () => {
    const drainedStream = new TestDuplex()
    drainedStream.acceptWrites = false
    const drained = new NdjsonConnection(drainedStream, 64).send({ ok: true })
    drainedStream.emit('drain')
    await expect(drained).resolves.toBeUndefined()

    const errorStream = new TestDuplex()
    errorStream.acceptWrites = false
    const failed = new NdjsonConnection(errorStream, 64).send({ ok: true })
    const error = new Error('write failed')
    errorStream.emit('error', error)
    await expect(failed).rejects.toBe(error)

    const closeStream = new TestDuplex()
    closeStream.acceptWrites = false
    const closed = new NdjsonConnection(closeStream, 64).send({ ok: true })
    closeStream.emit('close')
    await expect(closed).rejects.toThrow(/closed during write/)
  })
})

describe('JSON object guard', () => {
  it('accepts only non-null, non-array objects', () => {
    expect(isObject({})).toBe(true)
    expect(isObject(Object.create(null))).toBe(true)
    expect(isObject(null)).toBe(false)
    expect(isObject([])).toBe(false)
    expect(isObject('object')).toBe(false)
  })
})
