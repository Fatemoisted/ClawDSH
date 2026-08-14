/**
 * Narrow append capability for the Markdown memory store.
 *
 * The ordinary filesystem tools resolve their write boundary from the calling
 * session's cwd. A shared memory root commonly lives elsewhere, so this tool
 * preserves the session's effective sandbox MODE while replacing only the
 * workspace root for this one, allowlisted operation. The model never supplies
 * an absolute target: {@link resolveMemoryTarget} admits only `MEMORY.md` and
 * flat `memory/*.md` paths and re-checks canonical containment.
 *
 * @module @clawdsh/dsh-memory/append
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { resolveMemoryTarget } from './memory-files.ts'

/** Stable model-facing name of the append-only memory write capability. */
export const MEMORY_APPEND_TOOL = 'memory_append'

/** External writers may invalidate a guarded read; retry a bounded number of times. */
const MAX_APPEND_ATTEMPTS = 8

type SandboxExecutionPolicy = NonNullable<Parameters<FileSystem['writeText']>[4]>
type ToolAgent = NonNullable<ToolRunContext['agent']>

/** Structural slice of dsh-sandbox-policy used without making the optional seam a hard import. */
interface SandboxPolicyResolver {
  resolve(request?: { session?: ToolAgent['session'] }): SandboxExecutionPolicy
}

/** A target plus the amount of caller content accepted by one append. */
interface AppendResult {
  readonly path: string
  readonly contentChars: number
}

/**
 * Join caller content to a memory file without ever rewriting prior bytes.
 * A missing boundary newline is supplied on each side so independent notes do
 * not run together and every successful append leaves a line-terminated file.
 */
export function appendMemoryText(existing: string, content: string): string {
  if (content.length === 0) throw new TypeError('memory_append: content must be a non-empty string')
  const separator = existing.length > 0 && !existing.endsWith('\n') && !content.startsWith('\n') ? '\n' : ''
  const terminator = content.endsWith('\n') ? '' : '\n'
  return `${existing}${separator}${content}${terminator}`
}

/** Per-plugin serialization plus guarded retries against writers outside this plugin instance. */
class MemoryAppender {
  private readonly tails = new Map<FsTarget['targetKey'], Promise<unknown>>()

  constructor(private readonly ctx: Context) {}

  async append(
    target: FsTarget,
    content: string,
    signal: AbortSignal,
    policy: SandboxExecutionPolicy | undefined,
    actor: object,
  ): Promise<AppendResult> {
    return this.withTargetLock(target.targetKey, async () => {
      for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt += 1) {
        try {
          await this.appendOnce(target, content, signal, policy, actor)
          return { path: target.displayPath, contentChars: content.length }
        } catch (error: unknown) {
          if (attempt === MAX_APPEND_ATTEMPTS || !retryableAppendRace(error)) throw error
        }
      }
      /* v8 ignore next -- the bounded loop either returns or throws on its final attempt. */
      throw new Error('memory_append: exhausted append attempts')
    })
  }

  private async appendOnce(
    target: FsTarget,
    content: string,
    signal: AbortSignal,
    policy: SandboxExecutionPolicy | undefined,
    actor: object,
  ): Promise<void> {
    signal.throwIfAborted()
    const info = await this.ctx.fs.stat(target, signal)
    let existing: string
    let intent: FsWriteIntent
    if (info === undefined) {
      existing = ''
      intent = { kind: 'createIfAbsent' }
      this.ctx.emit('fs/observed', target, { kind: 'absent' }, actor)
    } else {
      if (info.type !== 'file') {
        throw new FsError(`cannot append memory "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      existing = await this.ctx.fs.readText(target, signal)
      intent = { kind: 'replaceIfVersion', version: info.version }
      this.ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, actor)
    }
    const outcome = await this.ctx.fs.writeText(
      target,
      appendMemoryText(existing, content),
      intent,
      signal,
      policy,
    )
    this.ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, actor)
  }

  private async withTargetLock<T>(targetKey: FsTarget['targetKey'], operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(targetKey) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(targetKey) === tail) this.tails.delete(targetKey)
    }
  }
}

function retryableAppendRace(error: unknown): boolean {
  return error instanceof FsError
    && (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED' || error.code === 'FS_NOT_FOUND')
}

/** Resolve the optional policy seam and fail loud when a confining fs has no policy owner. */
function resolveSandboxPolicy(ctx: Context): SandboxPolicyResolver | undefined {
  const candidate: unknown = ctx.get('sandboxPolicy')
  if (candidate === undefined) {
    if (ctx.fs.sandboxMode !== undefined) {
      throw new Error('memory: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
    return undefined
  }
  if (typeof candidate !== 'object' || candidate === null
    || typeof (candidate as { resolve?: unknown }).resolve !== 'function') {
    throw new Error('memory: ctx.sandboxPolicy does not expose resolve()')
  }
  return candidate as SandboxPolicyResolver
}

/** Install `memory_append` and return its registration disposer. */
export function installMemoryAppend(
  ctx: Context,
  rootTarget: () => Promise<FsTarget>,
  timeoutMs: number,
): () => void {
  const sandboxPolicy = resolveSandboxPolicy(ctx)
  const appender = new MemoryAppender(ctx)
  return ctx.tools.register(defineTool({
    name: MEMORY_APPEND_TOOL,
    description: 'Append text to MEMORY.md or memory/<file>.md in the configured durable memory store.',
    parameters: {
      path: { type: 'string', required: true, description: 'Memory-relative path: MEMORY.md or memory/<file>.md.' },
      content: { type: 'string', required: true, description: 'Non-empty Markdown text to append. Existing content is never replaced.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs,
    execute: async (args, exec) => {
      if (args.content.length === 0) throw new TypeError('memory_append: content must be a non-empty string')
      const root = await rootTarget()
      const target = await resolveMemoryTarget(ctx.fs, root, args.path)
      if (target === undefined) {
        throw new Error(`memory_append: "${args.path}" is not a memory path (MEMORY.md or memory/<file>.md)`)
      }
      const standing = sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
      const policy = standing === undefined
        ? undefined
        : { ...standing, workspaceRoot: ctx.fs.processPath(root) }
      const result = await appender.append(target, args.content, exec.signal, policy, exec)
      return `Appended ${result.contentChars} characters to ${args.path}.`
    },
  }))
}
