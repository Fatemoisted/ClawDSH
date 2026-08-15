/** Bounded strict-UTF-8 NDJSON transport used before JSON-RPC dispatch. @module @clawdsh/dsh-channel-openclaw/framing */

import type { Duplex } from 'node:stream'

/** One JSON object accepted from a complete frame. */
export type JsonObject = Record<string, unknown>

/** Error raised when the local peer violates framing. */
export class ChannelFrameError extends Error {
  /** Stable transport error code. */
  readonly code = 'CHANNEL_INVALID_FRAME'
}

/** Bounded object-only NDJSON over one local duplex stream. */
export class NdjsonConnection {
  private buffered = Buffer.alloc(0)
  private receiver: (value: JsonObject) => void = () => {}
  private readonly closeReceivers: Array<(error?: Error) => void> = []
  private closed = false

  constructor(
    private readonly stream: Duplex,
    private readonly maxFrameBytes: number,
  ) {
    stream.on('data', (chunk: Buffer | string) => { this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    stream.on('error', (error: Error) => { this.finish(error) })
    stream.on('close', () => { this.finish() })
  }

  /**
   * Replace the synchronous object receiver after handshake.
   * @param receiver - Callback for each complete validated object.
   */
  onValue(receiver: (value: JsonObject) => void): void {
    this.receiver = receiver
  }

  /**
   * Observe transport closure once.
   * @param receiver - Callback receiving the transport failure, when present.
   */
  onClose(receiver: (error?: Error) => void): void {
    this.closeReceivers.push(receiver)
  }

  /**
   * Serialize one lossless object frame and honor stream backpressure.
   * @param value - JSON object to serialize as one frame.
   * @returns Completion after the stream accepts the frame.
   */
  async send(value: JsonObject): Promise<void> {
    if (this.closed) throw new Error('channel-openclaw: IPC connection is closed')
    const serialized = JSON.stringify(value)
    const frame = Buffer.from(`${serialized}\n`, 'utf8')
    if (frame.byteLength - 1 > this.maxFrameBytes) throw new ChannelFrameError('outbound channel frame exceeds maxFrameBytes')
    if (this.stream.write(frame)) return
    await new Promise<void>((resolvePromise, reject) => {
      const cleanup = (): void => {
        this.stream.off('drain', drained)
        this.stream.off('error', failed)
        this.stream.off('close', closed)
      }
      const drained = (): void => { cleanup(); resolvePromise() }
      const failed = (error: Error): void => { cleanup(); reject(error) }
      const closed = (): void => { cleanup(); reject(new Error('channel-openclaw: IPC connection closed during write')) }
      this.stream.once('drain', drained)
      this.stream.once('error', failed)
      this.stream.once('close', closed)
    })
  }

  /**
   * Close the transport.
   * @param error - Optional failure used to destroy the underlying stream.
   */
  close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    if (error === undefined) this.stream.end()
    else this.stream.destroy(error)
    this.finish(error)
  }

  private consume(chunk: Buffer): void {
    if (this.closed) return
    this.buffered = Buffer.concat([this.buffered, chunk])
    while (true) {
      const newline = this.buffered.indexOf(0x0a)
      if (newline < 0) {
        if (this.buffered.byteLength > this.maxFrameBytes) this.fail('channel frame exceeds maxFrameBytes')
        return
      }
      if (newline > this.maxFrameBytes) {
        this.fail('channel frame exceeds maxFrameBytes')
        return
      }
      const line = this.buffered.subarray(0, newline)
      this.buffered = this.buffered.subarray(newline + 1)
      if (line.byteLength === 0) {
        this.fail('empty channel frame')
        return
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(line)
        const value = JSON.parse(text) as unknown
        if (!isObject(value)) throw new ChannelFrameError('channel frame must contain one JSON object')
        this.receiver(value)
      } catch (error) {
        this.close(error instanceof Error ? error : new ChannelFrameError(String(error)))
        return
      }
    }
  }

  private fail(message: string): void {
    this.close(new ChannelFrameError(message))
  }

  private finish(error?: Error): void {
    if (!this.closed) this.closed = true
    for (const receiver of this.closeReceivers.splice(0)) receiver(error)
  }
}

/**
 * Object guard shared by the framing and RPC layers.
 * @param value - Candidate JSON value.
 * @returns Whether the value is a non-null, non-array object.
 */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
