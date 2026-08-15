/**
 * The `ctx.channels` Service Definition: one communication-plane provider and one Agent-plane
 * driver, with explicit bidirectional dispatch and lifecycle-scoped registration.
 * @module @clawdsh/dsh-channel
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  ChannelActionV1,
  ChannelActionResultV1,
  ChannelDeliveryReportV1,
  ChannelDriverV1,
  ChannelHealthV1,
  ChannelProviderV1,
  ChannelSessionCloseV1,
  ChannelSessionResetResultV1,
  ChannelSessionResetV1,
  ChannelTurnCancelV1,
  ChannelTurnEnvelopeV1,
  ChannelTurnExecutionV1,
  ChannelTurnResultV1,
} from './types.ts'

export * from './brand.ts'
export * from './protocol.ts'
export * from './semantics.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    channels: Channels
  }
}

/** Stable failure codes emitted by the channel registry. */
export type ChannelErrorCode =
  | 'CHANNEL_INVALID_PROVIDER'
  | 'CHANNEL_DUPLICATE_PROVIDER'
  | 'CHANNEL_DUPLICATE_DRIVER'
  | 'CHANNEL_NO_PROVIDER'
  | 'CHANNEL_NO_DRIVER'
  | 'CHANNEL_DELIVERY_REPORT_UNSUPPORTED'

/** Structured channel registration or dispatch failure. */
export class ChannelError extends HarnessError {
  /** Machine-routable channel failure class. */
  override readonly code: ChannelErrorCode

  /**
   * Construct a channel failure with a stable code.
   * @param message - Human-readable failure description.
   * @param code - Machine-routable channel failure class.
   * @param options - Optional chained cause.
   */
  constructor(message: string, code: ChannelErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/**
 * Bidirectional channel runtime. A single provider owns platform communication, while a single
 * driver owns Agent execution. Registrations unwind with their contributing Cordis fibers.
 */
export class Channels extends Service {
  private provider: ChannelProviderV1 | undefined
  private driver: ChannelDriverV1 | undefined

  constructor(ctx: Context) {
    super(ctx, 'channels')
  }

  /**
   * Register the communication-plane provider.
   * @param provider - Platform action and health implementation with a non-blank id.
   * @returns A disposer that releases the single provider slot.
   * @throws {ChannelError} `CHANNEL_INVALID_PROVIDER` for a blank id or
   * `CHANNEL_DUPLICATE_PROVIDER` while another provider is active.
   */
  registerProvider(provider: ChannelProviderV1): () => void {
    if (provider.id.trim() === '') {
      throw new ChannelError('channel provider id must be non-blank', 'CHANNEL_INVALID_PROVIDER')
    }
    const dispose = this.ctx.effect(function* (this: Channels) {
      if (this.provider !== undefined) {
        throw new ChannelError(
          `channel provider "${this.provider.id}" is already registered`,
          'CHANNEL_DUPLICATE_PROVIDER',
        )
      }
      this.provider = provider
      yield () => { this.provider = undefined }
    }.bind(this), 'channels.registerProvider()')
    return () => void dispose()
  }

  /**
   * Register the Agent-plane driver.
   * @param driver - Turn and session-control implementation.
   * @returns A disposer that releases the single driver slot.
   * @throws {ChannelError} `CHANNEL_DUPLICATE_DRIVER` while another driver is active.
   */
  registerDriver(driver: ChannelDriverV1): () => void {
    const dispose = this.ctx.effect(function* (this: Channels) {
      if (this.driver !== undefined) {
        throw new ChannelError('a channel driver is already registered', 'CHANNEL_DUPLICATE_DRIVER')
      }
      this.driver = driver
      yield () => { this.driver = undefined }
    }.bind(this), 'channels.registerDriver()')
    return () => void dispose()
  }

  /**
   * Dispatch one admitted inbound turn to the active Agent-plane driver.
   * @param turn - Validated turn envelope.
   * @param execution - Explicit run cancellation and progress publication.
   * @returns The driver's terminal replayable result.
   * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
   */
  runTurn(turn: ChannelTurnEnvelopeV1, execution: ChannelTurnExecutionV1): Promise<ChannelTurnResultV1> {
    return this.requireDriver().runTurn(turn, execution)
  }

  /**
   * Cancel one exact live channel run.
   * @param request - Turn/run identity and caller intent.
   * @param signal - Optional cancellation of the control request.
   * @returns Completion after the driver accepts cancellation.
   * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
   */
  cancel(request: ChannelTurnCancelV1, signal?: AbortSignal): Promise<void> {
    return this.requireDriver().cancel(request, signal)
  }

  /**
   * Retire one channel session generation and accept its successor.
   * @param request - Current route and strictly newer generation.
   * @param signal - Optional cancellation of the control request.
   * @returns The accepted successor route and retired session identity, when present.
   * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
   */
  reset(request: ChannelSessionResetV1, signal?: AbortSignal): Promise<ChannelSessionResetResultV1> {
    return this.requireDriver().reset(request, signal)
  }

  /**
   * Drain and release one channel session generation.
   * @param request - Route and close cause.
   * @param signal - Optional cancellation of the control request.
   * @returns Completion after the driver closes the route.
   * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active.
   */
  close(request: ChannelSessionCloseV1, signal?: AbortSignal): Promise<void> {
    return this.requireDriver().close(request, signal)
  }

  /**
   * Project a provider-committed final-turn delivery receipt into the Agent plane.
   * @param report - Negotiated delivery-report extension payload.
   * @param signal - Optional cancellation of the projection request.
   * @returns Completion after the active driver records the receipt.
   * @throws {ChannelError} `CHANNEL_NO_DRIVER` when no driver is active or
   * `CHANNEL_DELIVERY_REPORT_UNSUPPORTED` when it did not register the optional extension.
   */
  reportDelivery(report: ChannelDeliveryReportV1, signal?: AbortSignal): Promise<void> {
    const driver = this.requireDriver()
    if (driver.reportDelivery === undefined) {
      throw new ChannelError(
        'the active channel driver does not support delivery.report',
        'CHANNEL_DELIVERY_REPORT_UNSUPPORTED',
      )
    }
    return driver.reportDelivery(report, signal)
  }

  /**
   * Execute one native platform action through the active provider.
   * @param action - Capability-checked outbound operation.
   * @param signal - Optional cancellation forwarded to the provider.
   * @returns The provider's durable delivery state.
   * @throws {ChannelError} `CHANNEL_NO_PROVIDER` when no provider is active.
   */
  action(action: ChannelActionV1, signal?: AbortSignal): Promise<ChannelActionResultV1> {
    return this.requireProvider().action(action, signal)
  }

  /**
   * Read current provider, Gateway, and account health.
   * @param signal - Optional cancellation forwarded to an active probe.
   * @returns A sanitized provider health snapshot.
   * @throws {ChannelError} `CHANNEL_NO_PROVIDER` when no provider is active.
   */
  health(signal?: AbortSignal): Promise<ChannelHealthV1> {
    return this.requireProvider().health(signal)
  }

  /** Resolve the active provider or fail before dispatch. */
  private requireProvider(): ChannelProviderV1 {
    if (this.provider === undefined) {
      throw new ChannelError('no channel provider is registered', 'CHANNEL_NO_PROVIDER')
    }
    return this.provider
  }

  /** Resolve the active driver or fail before dispatch. */
  private requireDriver(): ChannelDriverV1 {
    if (this.driver === undefined) {
      throw new ChannelError('no channel driver is registered', 'CHANNEL_NO_DRIVER')
    }
    return this.driver
  }
}

export default Channels
