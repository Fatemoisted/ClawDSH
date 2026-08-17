import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope, scopeTarget, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import * as Soul from '@clawdsh/dsh-soul'
import { PERSONA_SECTION, SOUL_SECTION } from '@clawdsh/dsh-soul'

class TestSettings extends SettingsProvider {
  constructor(ctx: Context, private readonly store: Record<string, unknown>) { super(ctx) }
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.store)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.store[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function harness(deploymentPersona: string, hostConfig: Soul.Config = { text: 'host identity' }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: deploymentPersona })
  await ctx.plugin(TestSettings, {})
  await ctx.plugin(Soul.SoulSettingsHost, hostConfig)
  return ctx
}

function sectionText(assembly: { sections: { name: string; text: string }[] }, name: string): string | undefined {
  return assembly.sections.find(section => section.name === name)?.text
}

interface PromptActivityInput {
  readonly sessionId: string
  readonly producer: 'soul'
  readonly section: 'persona' | 'clawdsh:soul'
  readonly mode: 'append' | 'replace'
  readonly characters: number
  readonly sha256: string
  readonly seq: number
}

function installActivity(ctx: Context, write: (input: PromptActivityInput) => Promise<unknown>): void {
  ctx.provide('clawdshActivity', { promptContribution: write } as never)
}

function emitRequestHeader(ctx: Context, scope: ScopeKey, sessionId: string, system: string, seq: number): void {
  const session = { id: sessionId }
  const event = { type: 'request/header', seq, data: { header: { system }, reason: 'initial' } }
  const emit = ctx.emit.bind(ctx) as unknown as (
    target: object,
    name: 'session/event',
    subject: typeof session,
    entry: typeof event,
  ) => void
  emit(scopeTarget(session, scope), 'session/event', session, event)
}

describe('the soul row', () => {
  it('declares Host Settings and session snapshot dependencies', () => {
    expect(Soul.SoulSettingsHost.inject).toEqual(['settings'])
    expect(Soul.inject).toEqual(['systemPrompt', 'clawdshSoulSettings'])
  })

  it('reads Host settings once per new session and can disable only subsequent Soul mounts', async () => {
    const ctx = await harness('deployment identity', { text: 'base identity' })
    const first: ScopeKey = { agent: 'first' }
    await createScope(ctx, first).ctx.plugin(Soul, { text: 'preset identity' })
    expect(sectionText(await ctx.systemPrompt.assemble({ scope: first }), SOUL_SECTION)).toBe('preset identity')

    await ctx.settings.update(Soul.SOUL_SETTINGS_NAMESPACE, { enabled: false })
    const second: ScopeKey = { agent: 'second' }
    await createScope(ctx, second).ctx.plugin(Soul, { text: 'preset identity' })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: first }), SOUL_SECTION)).toBe('preset identity')
    expect(sectionText(await ctx.systemPrompt.assemble({ scope: second }), SOUL_SECTION)).toBeUndefined()
    expect(ctx.settings.describe().find(entry => entry.ns === Soul.SOUL_SETTINGS_NAMESPACE)?.base)
      .toMatchObject({ enabled: true, text: 'base identity' })
    await ctx.fiber.dispose()
  })

  it('allows intentionally disabled Host and session rows without placeholder Soul content', async () => {
    const ctx = await harness('deployment identity', { enabled: false })
    const key: ScopeKey = { agent: 'disabled-soul' }

    await createScope(ctx, key).ctx.plugin(Soul, { enabled: false })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBeUndefined()
    expect(ctx.settings.describe().find(entry => entry.ns === Soul.SOUL_SETTINGS_NAMESPACE)?.value)
      .toMatchObject({ enabled: false })
    await ctx.fiber.dispose()
  })

  it('allows Settings to disable subsequent Sessions while clearing both content fields', async () => {
    const ctx = await harness('deployment identity', { text: 'base identity' })
    await ctx.settings.update(Soul.SOUL_SETTINGS_NAMESPACE, {
      enabled: false,
      source: '',
      text: '',
    })
    const key: ScopeKey = { agent: 'settings-disabled-soul' }

    await createScope(ctx, key).ctx.plugin(Soul, { text: 'preset identity' })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('records only the rendered Soul contribution that matches a committed request header', async () => {
    const ctx = await harness('deployment identity')
    const records: PromptActivityInput[] = []
    installActivity(ctx, async (input) => { records.push(input) })
    const agent = { id: 'soul-activity-session' }
    const scope = createScope(ctx, agent)
    const secretText = 'soul-private-canary-71b3'
    const dir = mkdtempSync(join(tmpdir(), 'clawdsh-soul-activity-'))
    const source = join(dir, 'private-soul.md')
    try {
      writeFileSync(source, secretText, 'utf8')
      await scope.ctx.plugin(Soul, { source, mode: 'append' })

      const assembly = await ctx.systemPrompt.assemble({
        scope: agent,
        signal: new AbortController().signal,
        agent,
      } as never)
      const system = renderPrompt(assembly)
      emitRequestHeader(ctx, agent, agent.id, system, 17)

      expect(records).toEqual([{
        sessionId: agent.id,
        producer: 'soul',
        section: 'clawdsh:soul',
        mode: 'append',
        characters: secretText.length,
        sha256: createHash('sha256').update(secretText).digest('hex'),
        seq: 17,
      }])
      expect(JSON.stringify(records)).not.toContain(secretText)
      expect(JSON.stringify(records)).not.toContain(source)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not report an append section suppressed by a complete section', async () => {
    const ctx = await harness('deployment identity')
    const records: PromptActivityInput[] = []
    installActivity(ctx, async (input) => { records.push(input) })
    const agent = { id: 'soul-suppressed-session' }
    const scope = createScope(ctx, agent)
    await scope.ctx.plugin(Soul, { text: 'suppressed-soul-canary', mode: 'append' })
    await scope.ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.systemPrompt.section({ name: 'test:complete', order: 20, text: 'complete override', complete: true })
    }, { inject: ['systemPrompt'] }))

    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)
    expect(renderPrompt(assembly)).toBe('complete override')
    emitRequestHeader(ctx, agent, agent.id, renderPrompt(assembly), 19)

    expect(records).toEqual([])
    await ctx.fiber.dispose()
  })

  it('records replace mode and contains a rejected Activity write', async () => {
    const ctx = await harness('deployment identity')
    const attempts: PromptActivityInput[] = []
    installActivity(ctx, async (input) => {
      attempts.push(input)
      throw new Error('activity-write-secret-canary')
    })
    const agent = { id: 'soul-replace-session' }
    const scope = createScope(ctx, agent)
    const text = 'replacement soul'
    await scope.ctx.plugin(Soul, { text, mode: 'replace' })
    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)

    expect(() => { emitRequestHeader(ctx, agent, agent.id, renderPrompt(assembly), 23) }).not.toThrow()
    await Promise.resolve()
    expect(attempts).toEqual([{
      sessionId: agent.id,
      producer: 'soul',
      section: 'persona',
      mode: 'replace',
      characters: text.length,
      sha256: createHash('sha256').update(text).digest('hex'),
      seq: 23,
    }])
    await ctx.fiber.dispose()
  })

  it('rejects an unscoped mount, which would publish a process-global soul', async () => {
    const ctx = await harness('deployment identity')

    await expect(ctx.plugin(Soul, { text: 'process identity' }))
      .rejects.toThrow(/only inside an agent scope/)
  })

  it('append mode: soul lands after the deployment persona and ahead of tool guidance', async () => {
    const ctx = await harness('deployment identity')
    const key: ScopeKey = { agent: 'a1' }
    ctx.systemPrompt.section({ name: 'global:guidance', order: 100, text: 'global guidance' })

    await createScope(ctx, key).ctx.plugin(Soul, { text: 'You are a loyal lobster.' })

    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    const names = assembly.sections.map(section => section.name)
    expect(names.indexOf(PERSONA_SECTION)).toBeLessThan(names.indexOf(SOUL_SECTION))
    expect(names.indexOf(SOUL_SECTION)).toBeLessThan(names.indexOf('global:guidance'))
    expect(sectionText(assembly, PERSONA_SECTION)).toBe('deployment identity')
    expect(sectionText(assembly, SOUL_SECTION)).toBe('You are a loyal lobster.')
    expect(renderPrompt(assembly)).toContain('You are a loyal lobster.')
    // The global scope is untouched by a scoped soul.
    expect(sectionText(await ctx.systemPrompt.assemble(), SOUL_SECTION)).toBeUndefined()
  })

  it('replace mode: the soul is the complete system prompt', async () => {
    const ctx = await harness('deployment identity')
    const key: ScopeKey = { agent: 'a1' }
    const scope = createScope(ctx, key)
    ctx.systemPrompt.section({ name: 'global:extra', order:100, text: 'global guidance' })

    await scope.ctx.plugin(Soul, { text: 'Only this.', mode: 'replace' })
    scope.ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      assembly.sections.push({ name: 'late:extra', text: 'late guidance' })
      return next()
    }, { prepend: true })

    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    expect(assembly.sections).toEqual([{ name: PERSONA_SECTION, text: 'Only this.' }])
    expect(renderPrompt(assembly)).toBe('Only this.')
  })

  it('restores the default prompt when its fiber unloads', async () => {
    const ctx = await harness('deployment identity')
    const key: ScopeKey = { agent: 'a1' }
    const scope = createScope(ctx, key)
    const fiber = await scope.ctx.plugin(Soul, { text: 'preset identity' })
    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe('preset identity')

    await fiber.dispose()

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBeUndefined()
  })

  it('gives two scopes independent souls', async () => {
    const ctx = await harness('')
    const first: ScopeKey = { agent: 'a1' }
    const second: ScopeKey = { agent: 'a2' }

    await createScope(ctx, first).ctx.plugin(Soul, { text: 'first identity' })
    await createScope(ctx, second).ctx.plugin(Soul, { text: 'second identity', mode: 'replace' })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: first }), SOUL_SECTION)).toBe('first identity')
    const secondAssembly = await ctx.systemPrompt.assemble({ scope: second })
    expect(secondAssembly.sections).toEqual([{ name: PERSONA_SECTION, text: 'second identity' }])
  })

  it('loads the soul text from a source file, which wins over inline text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawdsh-soul-'))
    try {
      const path = join(dir, 'soul.md')
      writeFileSync(path, 'I am the file soul.', 'utf8')

      const ctx = await harness('')
      const key: ScopeKey = { agent: 'a1' }
      await createScope(ctx, key).ctx.plugin(Soul, { source: path, text: 'inline identity' })

      expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe('I am the file soul.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a relative source against the mount tree baseUrl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawdsh-soul-'))
    try {
      writeFileSync(join(dir, 'assistant.md'), 'Preset soul text.', 'utf8')

      const ctx = await harness('')
      const key: ScopeKey = { agent: 'a1' }
      // baseUrl is a constructor-owned property: define it on an extended child
      // (the proxy set trap rejects plain assignment under a running fiber).
      const scope = createScope(ctx, key).ctx.extend({ baseUrl: pathToFileURL(join(dir, '')).href + '/' })
      await scope.plugin(Soul, { source: './assistant.md' })

      expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe('Preset soul text.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when the context has no baseUrl', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    // A relative source with no loader-provided base resolves against cwd and fails loud there.
    await expect(createScope(ctx, key).ctx.plugin(Soul, { source: 'clawdsh-definitely-missing-soul.md' }))
      .rejects.toThrow()
  })

  it('fails loud on a missing source file', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    await expect(createScope(ctx, key).ctx.plugin(Soul, { source: '/nonexistent/clawdsh-soul.md' }))
      .rejects.toThrow()
  })

  it('fails loud on empty text', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    await expect(createScope(ctx, key).ctx.plugin(Soul, { text: '' }))
      .rejects.toThrow(/non-empty/)
    await expect(createScope(ctx, key).ctx.plugin(Soul, { text: ' \n\t ' }))
      .rejects.toThrow(/non-empty/)
  })

  it('treats a whitespace-only source as absent and uses inline text', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'inline-fallback' }

    await createScope(ctx, key).ctx.plugin(Soul, { source: '   ', text: 'Inline identity.' })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe('Inline identity.')
  })

  it('fails loud on an unknown mode', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    // The schema rejects unknown modes before apply runs; the apply-level
    // guard remains as defense for direct apply() calls.
    await expect(createScope(ctx, key).ctx.plugin(Soul, { text: 'x', mode: 'overwrite' as 'append' }))
      .rejects.toThrow(/\$\.mode expected/)
    expect(() => { Soul.apply(createScope(ctx, key).ctx, { text: 'x', mode: 'overwrite' as 'append' }) })
      .toThrow(/unknown mode/)
  })

  it('can suppress runtime context for its scope without changing the global assembly', async () => {
    const ctx = await harness('deployment identity')
    const key: ScopeKey = { agent: 'a1' }
    const scope = createScope(ctx, key)
    ctx.systemPrompt.context({ name: 'policy', order: 1, text: 'global policy' })

    const fiber = await scope.ctx.plugin(Soul, {
      text: 'Only this.',
      includeRuntimeContext: false,
    })
    const suppressed = await ctx.systemPrompt.assemble({ scope: key })
    expect(suppressed.contexts).toEqual([])
    const global = await ctx.systemPrompt.assemble()
    expect(global.contexts).toEqual([
      { name: 'policy', text: 'global policy' },
    ])

    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble({ scope: key })).contexts).toEqual([
      { name: 'policy', text: 'global policy' },
    ])
  })

  it('validates every persisted Soul field before merging a new-session snapshot', async () => {
    const ctx = await harness('deployment identity', { text: 'base identity' })
    const describe = vi.spyOn(ctx.settings, 'describe')
    const user = (value: Record<string, unknown>) => {
      describe.mockReturnValue([{ ns: Soul.SOUL_SETTINGS_NAMESPACE, user: value }] as never)
    }

    user({ enabled: 'yes' })
    expect(() => ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toThrow(/enabled.*boolean/)
    user({ source: 1 })
    expect(() => ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toThrow(/source.*string/)
    user({ text: 1 })
    expect(() => ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toThrow(/text.*string/)
    user({ mode: 'overwrite' })
    expect(() => ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toThrow(/mode.*replace.*append/)
    user({ includeRuntimeContext: 'no' })
    expect(() => ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toThrow(/includeRuntimeContext.*boolean/)

    user({
      enabled: true,
      source: 'soul.md',
      text: 'user identity',
      mode: 'replace',
      includeRuntimeContext: false,
    })
    expect(ctx.clawdshSoulSettings.forSession({ text: 'entry' })).toMatchObject({
      enabled: true,
      source: 'soul.md',
      text: 'user identity',
      mode: 'replace',
      includeRuntimeContext: false,
    })
    await ctx.fiber.dispose()
  })

  it('rejects an enabled persisted snapshot that clears both Soul sources', async () => {
    const ctx = await harness('deployment identity', { text: 'base identity' })

    await expect(ctx.settings.update(Soul.SOUL_SETTINGS_NAMESPACE, {
      enabled: true,
      source: '',
      text: '',
    })).rejects.toThrow(/non-empty/)
    await ctx.fiber.dispose()
  })

  it('supports a direct scoped apply call without a settings host', async () => {
    const withoutHost = new Context()
    await withoutHost.plugin(SystemPrompt)
    const first = { id: 'direct-without-host' }
    await createScope(withoutHost, first).ctx.plugin(Object.assign((pluginCtx: Context) => {
      Soul.apply(pluginCtx, { text: 'direct identity' })
    }, { inject: ['systemPrompt'] }))
    expect(sectionText(await withoutHost.systemPrompt.assemble({ scope: first }), SOUL_SECTION)).toBe('direct identity')
    await withoutHost.fiber.dispose()
  })

  it('drops stale, mismatched, and unrenderable Activity candidates', async () => {
    const ctx = await harness('deployment identity')
    const records: PromptActivityInput[] = []
    installActivity(ctx, async (input) => { records.push(input) })
    const agent = { id: 'soul-candidate-session' }
    const scope = createScope(ctx, agent)
    await scope.ctx.plugin(Soul, { text: 'candidate identity' })

    const emitOtherEvent = ctx.emit.bind(ctx) as unknown as (
      target: object,
      name: 'session/event',
      session: { id: string },
      event: { type: string },
    ) => void
    emitOtherEvent(scopeTarget({ id: agent.id }, agent), 'session/event', { id: agent.id }, { type: 'turn/start' })

    let assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)
    emitRequestHeader(ctx, agent, 'another-session', renderPrompt(assembly), 31)

    assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)
    emitRequestHeader(ctx, agent, agent.id, 'different system prompt', 32)
    expect(records).toEqual([])

    const disposeMalformed = ctx.systemPrompt.section({
      name: 'soul-malformed-variable',
      order: 0,
      text: '{{missing}}',
    })
    await expect(ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)).resolves.toBeDefined()
    disposeMalformed()

    scope.ctx.on('system-prompt/assemble', async (nextAssembly, _context, next) => {
      const transformed = await next()
      const section = nextAssembly.sections.find(item => item.name === SOUL_SECTION)
      if (section !== undefined) section.text = 'changed downstream'
      return transformed
    })
    assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)
    emitRequestHeader(ctx, agent, agent.id, renderPrompt(assembly), 33)
    expect(records).toEqual([])
    await ctx.fiber.dispose()
  })

  it('contains a synchronous Activity failure', async () => {
    const clean = await harness('deployment identity')
    clean.provide('clawdshActivity', {
      promptContribution(): Promise<unknown> {
        throw new Error('synchronous activity failure')
      },
    } as never)
    const cleanAgent = { id: 'soul-sync-activity-session' }
    await createScope(clean, cleanAgent).ctx.plugin(Soul, { text: 'candidate identity' })
    const assembly = await clean.systemPrompt.assemble({
      scope: cleanAgent,
      signal: new AbortController().signal,
      agent: cleanAgent,
    } as never)
    expect(() => { emitRequestHeader(clean, cleanAgent, cleanAgent.id, renderPrompt(assembly), 34) }).not.toThrow()

    await clean.fiber.dispose()
  })

  it('commits a rendered Soul prompt when Activity is not mounted', async () => {
    const ctx = await harness('deployment identity')
    const agent = { id: 'soul-without-activity-session' }
    await createScope(ctx, agent).ctx.plugin(Soul, { text: 'standalone identity' })
    const assembly = await ctx.systemPrompt.assemble({
      scope: agent,
      signal: new AbortController().signal,
      agent,
    } as never)

    expect(() => { emitRequestHeader(ctx, agent, agent.id, renderPrompt(assembly), 41) }).not.toThrow()
    await ctx.fiber.dispose()
  })
})
