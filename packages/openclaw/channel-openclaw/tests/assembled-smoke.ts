/** Keyless locked-Gateway → ClawDSH Agent assembled smoke. @module */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ChannelService from '@clawdsh/dsh-channel'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AttachmentId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as ChannelAgent from '../../channel-agent/src/index.ts'
import { OpenClawSupervisor, type OpenClawSupervisorConfig } from '../src/index.ts'

const FINAL_TEXT = 'clawdsh-assembled-final-7c2b'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const RUNTIME_SOURCE_ROOT = join(REPOSITORY_ROOT, 'packages/openclaw/channel-openclaw/runtime')
const BRIDGE_ROOT = join(REPOSITORY_ROOT, 'packages/openclaw/channel-openclaw/bridge/stable-v1')

class TestSettings extends SettingsProvider {
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Deterministic keyless model used by the real ClawDSH Agent loop. */
class AssembledMockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: FINAL_TEXT }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: FINAL_TEXT } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface CliOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

/** Reserve one loopback port long enough to obtain an operator-style explicit value. */
async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  assert(address !== null && typeof address !== 'string')
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) resolvePromise()
      else reject(error)
    })
  })
  return address.port
}

/** Materialize the same runtime tree that the public installer publishes. */
async function materializeInstalledRuntime(root: string): Promise<{
  readonly runtimeRoot: string
  readonly hostRoot: string
}> {
  const runtimeRoot = join(root, 'runtime')
  await mkdir(runtimeRoot, { mode: 0o700 })
  await Promise.all([
    copyFile(join(RUNTIME_SOURCE_ROOT, 'package.json'), join(runtimeRoot, 'package.json')),
    copyFile(join(RUNTIME_SOURCE_ROOT, 'package-lock.json'), join(runtimeRoot, 'package-lock.json')),
    cp(join(RUNTIME_SOURCE_ROOT, 'node_modules'), join(runtimeRoot, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
    }),
  ])
  return { runtimeRoot, hostRoot: join(runtimeRoot, 'node_modules/openclaw') }
}

/** Build the sole-provider, no-fallback config accepted by both local validation layers. */
function openClawConfig(
  stateDir: string,
  gatewayPort: number,
  channels: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    models: {
      mode: 'replace',
      providers: {
        clawdsh: {
          baseUrl: 'http://127.0.0.1:9/v1',
          apiKey: 'clawdsh-local',
          auth: 'token',
          api: 'openai-responses',
          agentRuntime: { id: 'clawdsh' },
          models: [{
            id: 'local',
            name: 'ClawDSH local agent',
            api: 'openai-responses',
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200_000,
            maxTokens: 32_768,
            agentRuntime: { id: 'clawdsh' },
          }],
        },
      },
    },
    agents: {
      defaults: {
        workspace: join(stateDir, 'workspace'),
        model: { primary: 'clawdsh/local', fallbacks: [] },
        models: { 'clawdsh/local': { agentRuntime: { id: 'clawdsh' } } },
        elevatedDefault: 'off',
      },
      list: [],
    },
    plugins: {
      load: { paths: [BRIDGE_ROOT] },
      allow: ['clawdsh-bridge'],
      installs: {},
      entries: {
        'clawdsh-bridge': {
          enabled: true,
          config: {
            controlTimeoutMs: 2_000,
            routeStateMaxEntries: 100,
            deliveryStateMaxEntries: 100,
          },
        },
      },
    },
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: gatewayPort,
      auth: { mode: 'none' },
    },
    session: { dmScope: 'per-account-channel-peer' },
    commands: {
      bash: false,
      config: false,
      mcp: false,
      plugins: false,
      debug: false,
      restart: false,
      nativeSkills: false,
      text: true,
      useAccessGroups: true,
    },
    tools: { elevated: { enabled: false } },
    channels,
  }
}

/** Prove the locked stable host accepts credential-free policy-complete pilot Channel configs. */
async function validatePilotChannelConfigs(
  ctx: Context,
  stateDir: string,
  gatewayPort: number,
  hostRoot: string,
): Promise<void> {
  const variants: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
    ['telegram', {
      telegram: {
        enabled: true,
        configWrites: false,
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
        groups: { '*': { requireMention: true } },
      },
    }],
    ['feishu', {
      feishu: {
        enabled: true,
        configWrites: false,
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
        requireMention: true,
      },
    }],
  ]
  for (const [name, channels] of variants) {
    const path = join(stateDir, `openclaw-${name}-validate.json`)
    await writeFile(path, `${JSON.stringify(openClawConfig(stateDir, gatewayPort, channels), null, 2)}\n`, { mode: 0o600 })
    const validation = await runOpenClaw(ctx, path, stateDir, hostRoot, ['config', 'validate', '--json'])
    assert.equal(
      validation.exitCode,
      0,
      `locked OpenClaw rejected the credential-free ${name} policy config: ${validation.stderr}\n${validation.stdout}`,
    )
  }
}

/** Mount the real Channel Service, Agent consumer, Agent loop, persistence, and subprocess provider. */
async function mountDsh(root: string): Promise<{
  readonly ctx: Context
  readonly adapter: AssembledMockAdapter
  readonly pool: MemoryMediaPool
}> {
  const ctx = new Context()
  await ctx.plugin(TestSettings)
  const adapter = new AssembledMockAdapter()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(SessionPersistenceJsonl, {
    root: join(root, 'sessions'),
    compression: 'none',
    writeBatchMaxDelayMs: 1,
  })
  ctx.llm.registerAdapter(['mock'], adapter)

  await ctx.plugin(Storage)
  const pool = new MemoryMediaPool()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('agentPresets', {
    async mount(): Promise<void> {},
  } as never)
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 1_024,
      maxImagesPerMessage: 1,
      maxMessageImageBytes: 1_024,
      maxImagePixels: 1_000,
      mediaTypes: ['image/png'],
    },
    async validateImage(): Promise<void> {},
    async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
      return {
        attachmentId: AttachmentId(createHash('sha256').update(input.data).digest('hex')),
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
    },
  } as never)

  await ctx.plugin(ChannelService)
  await mkdir(join(root, 'dsh-workspace'), { recursive: true })
  await ctx.plugin(ChannelAgent, {
    ownerPreset: 'owner',
    safePreset: 'messaging-safe',
    cwd: join(root, 'dsh-workspace'),
    stagingRoot: join(root, 'state', 'staging'),
    maxMediaBytes: 1_024,
    shutdownGraceMs: 5_000,
  })
  await ctx.plugin(LocalSubprocessRuntime)
  return { ctx, adapter, pool }
}

/** Invoke one public OpenClaw CLI command in the isolated state directory. */
async function runOpenClaw(
  ctx: Context,
  configPath: string,
  stateDir: string,
  hostRoot: string,
  arguments_: readonly string[],
): Promise<CliOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error('assembled OpenClaw agent request timed out'))
  }, 30_000)
  timeout.unref()
  const handle = ctx.subprocess.spawn({
    argv: [
      process.execPath,
      join(hostRoot, 'openclaw.mjs'),
      ...arguments_,
    ],
    cwd: hostRoot,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4 * 1024 * 1024 },
      stderr: { maxBytes: 4 * 1024 * 1024 },
    },
    graceMs: 5_000,
    signal: controller.signal,
    env: {
      NODE_OPTIONS: undefined,
      NODE_PATH: undefined,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_NIX_MODE: '1',
      OPENCLAW_STATE_DIR: stateDir,
    },
  })
  try {
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    assert(stdout !== undefined && stderr !== undefined && !stdout.lossy && !stderr.lossy)
    return { ...outcome, stdout: stdout.text, stderr: stderr.text }
  } finally {
    clearTimeout(timeout)
  }
}

/** Invoke the public OpenClaw Agent CLI through the running Gateway. */
function runAgent(
  ctx: Context,
  configPath: string,
  stateDir: string,
  hostRoot: string,
  target: string,
  message: string,
): Promise<CliOutcome> {
  return runOpenClaw(ctx, configPath, stateDir, hostRoot, [
    'agent',
    '--to', target,
    '--channel', 'sms',
    '--message', message,
    '--model', 'clawdsh/local',
    '--json',
    '--timeout', '20',
  ])
}

/** Require one strict JSON CLI response and return a searchable projection. */
function strictCliJson(outcome: CliOutcome, label: string): unknown {
  assert.equal(outcome.signal, null, `${label} was signalled: ${outcome.stderr}`)
  assert.equal(outcome.exitCode, 0, `${label} failed: ${outcome.stderr}`)
  try {
    return JSON.parse(outcome.stdout) as unknown
  } catch (cause) {
    throw new Error(`${label} did not emit strict JSON: ${outcome.stdout}`, { cause })
  }
}

/** Execute the production host and prove the terminal-result and fail-closed paths. */
async function main(): Promise<void> {
  const artifactPath = process.argv[2]
  if (artifactPath === undefined || !isAbsolute(artifactPath)) {
    throw new Error('usage: assembled-smoke.ts /absolute/path/openclaw-2026.7.1-2.tgz')
  }
  const root = await mkdtemp(join(tmpdir(), 'clawdsh-openclaw-assembled-'))
  await chmod(root, 0o700)
  const stateDir = join(root, 'state')
  await mkdir(stateDir, { mode: 0o700 })
  await mkdir(join(stateDir, 'staging'), { mode: 0o700 })
  const configPath = join(stateDir, 'openclaw.json')
  const gatewayPort = await availablePort()
  await writeFile(configPath, `${JSON.stringify(openClawConfig(stateDir, gatewayPort), null, 2)}\n`, { mode: 0o600 })
  const { runtimeRoot, hostRoot } = await materializeInstalledRuntime(root)

  const app = await mountDsh(root)
  let supervisor: OpenClawSupervisor | undefined
  let unregisterProvider: (() => void) | undefined
  try {
    await validatePilotChannelConfigs(app.ctx, stateDir, gatewayPort, hostRoot)
    const config: OpenClawSupervisorConfig = {
      track: 'production',
      gatewayInstanceId: 'assembled-gateway',
      artifactPath: resolve(artifactPath),
      runtimeRoot,
      hostRoot,
      extensions: [],
      nodePath: process.execPath,
      configPath,
      stateDir,
      stagingRoot: join(stateDir, 'staging'),
      maxMediaBytes: 1_024,
      endpoint: join(stateDir, 'clawdsh.sock'),
      gatewayPort,
      maxFrameBytes: 1024 * 1024,
      maxInFlight: 8,
      requestTimeoutMs: 5_000,
      handshakeTimeoutMs: 5_000,
      startupTimeoutMs: 30_000,
      shutdownGraceMs: 5_000,
      diagnosticBytes: 4 * 1024 * 1024,
    }
    const validation = await runOpenClaw(app.ctx, configPath, stateDir, hostRoot, ['config', 'validate', '--json'])
    assert.equal(
      validation.exitCode,
      0,
      `locked OpenClaw rejected the assembled config: ${validation.stderr}\n${validation.stdout}`,
    )
    supervisor = await OpenClawSupervisor.start(app.ctx, config)
    unregisterProvider = app.ctx.channels.registerProvider(supervisor.provider)
    assert.equal((await supervisor.provider.health()).status, 'ready', 'the assembled bridge must be ready before ingress')

    const completed = strictCliJson(await runAgent(
      app.ctx,
      configPath,
      stateDir,
      hostRoot,
      '+15555550123',
      'Return the assembled smoke marker.',
    ), 'completed Gateway request')
    const completedText = JSON.stringify(completed)
    assert(
      completedText.includes(FINAL_TEXT),
      `Gateway result omitted the DSH final text; health=${JSON.stringify(await supervisor.provider.health())}: ${completedText}`,
    )
    assert(completedText.includes('"fallbackUsed":false'), 'the completed request must report no model fallback')
    assert.equal(app.adapter.requests.length, 1, 'the Gateway request must execute exactly one DSH model call')

    const ledger = app.pool.media.get('clawdsh_channel_agent')?.tables.get('ledger')
    assert(ledger !== undefined && ledger.size === 1, 'the Agent consumer must persist one inbound turn')
    const record = [...ledger.values()][0] as { readonly phase?: unknown; readonly delivery?: unknown } | undefined
    assert.equal(record?.phase, 'completed', 'the assembled path must persist a terminal Agent result')
    assert.equal(record?.delivery, undefined, 'no final platform receipt may be fabricated without a public host hook')

    await supervisor.provider.dispose()
    const disconnected = strictCliJson(await runAgent(
      app.ctx,
      configPath,
      stateDir,
      hostRoot,
      '+15555550124',
      'This must fail through the disconnected ClawDSH bridge.',
    ), 'disconnected Gateway request')
    const disconnectedText = JSON.stringify(disconnected)
    assert(
      disconnectedText.includes('[ClawDSH bridge CHANNEL_BRIDGE_FAILED]'),
      `disconnected bridge did not return the fail-closed harness result: ${disconnectedText}`,
    )
    assert(!disconnectedText.includes(FINAL_TEXT), 'a disconnected bridge must not replay an unrelated DSH answer')
    assert(disconnectedText.includes('"fallbackUsed":false'), 'a disconnected bridge must report no model fallback')
    assert.equal(app.adapter.requests.length, 1, 'a disconnected bridge must not start another DSH Agent or fall through to a model')

    process.stdout.write(
      'Locked OpenClaw Gateway → ClawDSH Agent terminal-result smoke passed; final platform receipt remains unasserted because the locked host exposes no correlatable public hook.\n',
    )
  } finally {
    unregisterProvider?.()
    await Promise.allSettled([
      supervisor?.dispose(),
      app.ctx.fiber.dispose(),
    ])
    await rm(root, { recursive: true, force: true })
  }
}

await main()
