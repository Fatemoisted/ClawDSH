import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import * as Soul from '@clawdsh/dsh-soul'
import { PERSONA_SECTION, SOUL_PRECEDENCE_NOTE, SOUL_SECTION } from '@clawdsh/dsh-soul'

async function harness(deploymentPersona: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: deploymentPersona })
  return ctx
}

function sectionText(assembly: { sections: { name: string; text: string }[] }, name: string): string | undefined {
  return assembly.sections.find(section => section.name === name)?.text
}

function withNote(text: string): string {
  return `${SOUL_PRECEDENCE_NOTE}\n\n${text}`
}

describe('the soul row', () => {
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
    expect(sectionText(assembly, SOUL_SECTION)).toBe(withNote('You are a loyal lobster.'))
    expect(renderPrompt(assembly)).toContain(withNote('You are a loyal lobster.'))
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
    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe(withNote('preset identity'))

    await fiber.dispose()

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBeUndefined()
  })

  it('gives two scopes independent souls', async () => {
    const ctx = await harness('')
    const first: ScopeKey = { agent: 'a1' }
    const second: ScopeKey = { agent: 'a2' }

    await createScope(ctx, first).ctx.plugin(Soul, { text: 'first identity' })
    await createScope(ctx, second).ctx.plugin(Soul, { text: 'second identity', mode: 'replace' })

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: first }), SOUL_SECTION)).toBe(withNote('first identity'))
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

      expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe(withNote('I am the file soul.'))
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
    await expect(createScope(ctx, key).ctx.plugin(Soul, { text: '', precedenceNote: false }))
      .rejects.toThrow(/non-empty/)
    // A direct apply with no text at all takes the `?? ''` fallback and rejects
    // before any precedence-note prepend can run.
    expect(() => Soul.apply(createScope(ctx, key).ctx, {}))
      .toThrow(/non-empty/)
  })

  it('fails loud on an unknown mode', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    // The schema rejects unknown modes before apply runs; the apply-level
    // guard remains as defense for direct apply() calls.
    await expect(createScope(ctx, key).ctx.plugin(Soul, { text: 'x', mode: 'overwrite' as 'append' }))
      .rejects.toThrow(/\$\.mode expected/)
    expect(() => Soul.apply(createScope(ctx, key).ctx, { text: 'x', mode: 'overwrite' as 'append' }))
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

  it('precedenceNote: false keeps the append-mode soul bare', async () => {
    const ctx = await harness('deployment identity')
    const key: ScopeKey = { agent: 'a1' }

    await createScope(ctx, key).ctx.plugin(Soul, { text: 'You are a loyal lobster.', precedenceNote: false })

    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    expect(sectionText(assembly, SOUL_SECTION)).toBe('You are a loyal lobster.')
    expect(renderPrompt(assembly)).not.toContain(SOUL_PRECEDENCE_NOTE)
  })

  it('replace mode never adds the precedence note', async () => {
    const ctx = await harness('deployment identity')
    // Scope keys are identity-compared, so each mount and assembly reuse one key object.
    const first: ScopeKey = { agent: 'a1' }
    const second: ScopeKey = { agent: 'a2' }

    await createScope(ctx, first).ctx.plugin(Soul, { text: 'Only this.', mode: 'replace' })
    const defaulted = await ctx.systemPrompt.assemble({ scope: first })
    expect(defaulted.sections).toEqual([{ name: PERSONA_SECTION, text: 'Only this.' }])
    expect(renderPrompt(defaulted)).toBe('Only this.')

    await createScope(ctx, second).ctx.plugin(Soul, { text: 'Only this.', mode: 'replace', precedenceNote: false })
    const disabled = await ctx.systemPrompt.assemble({ scope: second })
    expect(disabled.sections).toEqual([{ name: PERSONA_SECTION, text: 'Only this.' }])
    expect(renderPrompt(disabled)).toBe('Only this.')
  })

  it('apply-level fallback: omitted mode and precedenceNote behave like their schema defaults', async () => {
    const ctx = await harness('')
    const key: ScopeKey = { agent: 'a1' }

    // A direct apply() bypasses schema defaulting, so the apply-level `??`
    // fallbacks run; the wrapper fiber declares systemPrompt so the effect can
    // resolve the property access (same pattern as dsh-persona's spec).
    await ctx.plugin(Object.assign((inner: Context) => {
      Soul.apply(createScope(inner, key).ctx, { text: 'fallback identity' })
    }, { inject: ['systemPrompt'] }))

    expect(sectionText(await ctx.systemPrompt.assemble({ scope: key }), SOUL_SECTION)).toBe(withNote('fallback identity'))
  })
})
