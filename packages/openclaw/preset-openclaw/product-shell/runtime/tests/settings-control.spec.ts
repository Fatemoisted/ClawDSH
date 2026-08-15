import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, SettingsConflictError, type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import {
  CLAWDSH_READ_REQUEST,
  CLAWDSH_RPC_ENDPOINTS,
} from '../../shared/src/protocol.ts'
import { ClawdshSettingsControl } from '../src/settings-control.ts'

function descriptor(
  ns: string,
  schema: z,
  value: unknown,
  revision = 0,
  base?: unknown,
  user?: unknown,
): SettingsDescriptor {
  return {
    ns: settingsNamespace(ns),
    schema: schema.toJSON(),
    value,
    revision,
    ...(base === undefined ? {} : { base }),
    ...(user === undefined ? {} : { user }),
    applies: 'restart',
  }
}

function contextWith(services: Record<string, unknown>): Context {
  const available = {
    settings: { describe: () => [] },
    credentials: { describe: async () => ({ configured: false, writable: true }) },
    ...services,
  }
  return {
    get(name: string) {
      return available[name as keyof typeof available]
    },
  } as unknown as Context
}

function readyControl(services: Record<string, unknown>): ClawdshSettingsControl {
  const control = new ClawdshSettingsControl(contextWith(services))
  if (!control.captureRuntime()) throw new Error('test control did not capture runtime state')
  control.markReady()
  return control
}

describe('ClawDSH Settings control', () => {
  it('returns a stable retryable startup failure before runtime capture', async () => {
    const describe = vi.fn(() => [])
    const credentialSet = vi.fn(async () => undefined)
    const control = new ClawdshSettingsControl(contextWith({
      settings: { describe },
      credentials: { set: credentialSet },
    }))
    const requests: Array<[string, unknown]> = [
      [CLAWDSH_RPC_ENDPOINTS.settingsDescribe, CLAWDSH_READ_REQUEST],
      [CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
        version: 1,
        namespace: 'clawdsh-memory',
        expectedRevision: 0,
        operations: [{ op: 'set', path: ['enabled'], value: false }],
      }],
      [CLAWDSH_RPC_ENDPOINTS.settingsReset, {
        version: 1,
        namespace: 'clawdsh-memory',
        expectedRevision: 0,
      }],
      [CLAWDSH_RPC_ENDPOINTS.credentialsDescribe, CLAWDSH_READ_REQUEST],
      [CLAWDSH_RPC_ENDPOINTS.credentialsSet, { version: 1, id: 'ark-api-key', value: 'canary' }],
      [CLAWDSH_RPC_ENDPOINTS.credentialsUnset, { version: 1, id: 'ark-api-key' }],
    ]
    for (const [endpoint, payload] of requests) {
      await expect(control.handle(endpoint, payload)).resolves.toEqual({
        ok: false,
        error: {
          code: 'internal',
          message: 'ClawDSH control is starting; retry shortly',
          details: {},
        },
      })
    }
    expect(describe).not.toHaveBeenCalled()
    expect(credentialSet).not.toHaveBeenCalled()
  })

  it('projects the required Activity namespace registered by the Activity plugin', async () => {
    const schema = z.object({ enabled: z.const(true).default(true) })
    const register = vi.fn()
    const registered = descriptor(
      'clawdsh-activity',
      schema,
      { enabled: true },
      0,
      { enabled: true },
    )
    const settings = {
      register,
      describe: () => [registered],
    }
    const control = new ClawdshSettingsControl(contextWith({ settings }))

    expect(control.captureRuntime()).toBe(true)
    control.markReady()
    const result = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsDescribe, CLAWDSH_READ_REQUEST)

    expect(register).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      value: {
        namespaces: [{
          namespace: 'clawdsh-activity',
          value: { enabled: true },
          fields: [{ path: ['enabled'], access: 'managed' }],
        }],
      },
    })
  })

  it('returns only registered allowlisted namespaces in product order', async () => {
    const memorySchema = z.object({ enabled: z.boolean().default(true) })
    const soulSchema = z.object({ enabled: z.boolean().default(true) })
    const settings = {
      describe: vi.fn(() => [
        descriptor('community-extra', memorySchema, { enabled: true }),
        descriptor('clawdsh-memory', memorySchema, { enabled: true }),
        {
          ...descriptor('clawdsh-soul', soulSchema, { enabled: true }),
          secrets: [{ path: ['hidden'], kind: 'string' }],
        },
      ]),
    }
    const control = readyControl({ settings })

    const result = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsDescribe, CLAWDSH_READ_REQUEST)

    expect(result).toMatchObject({ ok: true })
    if (result?.ok !== true) throw new Error('expected settings describe success')
    if (!('namespaces' in result.value)) throw new Error('expected settings namespace catalog')
    const payload = result.value
    expect(payload.namespaces.map(item => item.namespace)).toEqual(['clawdsh-soul', 'clawdsh-memory'])
    expect(JSON.stringify(payload)).not.toContain('community-extra')
    expect(JSON.stringify(payload)).not.toContain('hidden')
    expect(settings.describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('strips stale schema-external Ark secrets from every projected layer and runtime snapshot', async () => {
    const valueCanary = 'value-api-key-secret-canary'
    const baseCanary = 'base-api-key-secret-canary'
    const userCanary = 'user-api-key-secret-canary'
    const schema = z.object({
      baseURL: z.string().default('https://ark.example'),
      model: z.string().default('embedding-v1'),
      managedSecret: z.string().role('secret'),
    })
    let current: SettingsDescriptor = {
      ...descriptor(
        'clawdsh-embeddings-ark',
        schema,
        { baseURL: 'https://ark.example', model: 'embedding-v1', apiKey: valueCanary },
        7,
        { baseURL: 'https://ark.example', model: 'embedding-v1', apiKey: baseCanary },
        { model: 'embedding-v1', apiKey: userCanary },
      ),
      secrets: [{ path: ['managedSecret'], set: true }],
    }
    const replace = vi.fn(async (_ns: unknown, section: object, expected: number) => {
      expect(section).toEqual({})
      expect(expected).toBe(7)
      current = {
        ...descriptor(
          'clawdsh-embeddings-ark',
          schema,
          { baseURL: 'https://ark.example', model: 'embedding-v1', apiKey: baseCanary },
          8,
          { baseURL: 'https://ark.example', model: 'embedding-v1', apiKey: baseCanary },
        ),
        secrets: [{ path: ['managedSecret'], set: true }],
      }
    })
    const settings = { describe: vi.fn(() => [current]), replace }
    const control = readyControl({ settings })

    const described = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsDescribe, CLAWDSH_READ_REQUEST)
    expect(described).toMatchObject({
      ok: true,
      value: {
        namespaces: [{
          value: { baseURL: 'https://ark.example', model: 'embedding-v1' },
          base: { baseURL: 'https://ark.example', model: 'embedding-v1' },
          user: { model: 'embedding-v1' },
          restartRequired: false,
        }],
      },
    })
    if (described?.ok !== true || !('namespaces' in described.value)) {
      throw new Error('expected projected settings catalog')
    }
    const projected = described.value.namespaces[0]
    expect(projected?.value).not.toHaveProperty('managedSecret')
    expect(projected?.base).not.toHaveProperty('managedSecret')
    expect(projected?.user).not.toHaveProperty('managedSecret')
    const describedJson = JSON.stringify(described)
    expect(describedJson).not.toContain('apiKey')
    expect(describedJson).not.toContain(valueCanary)
    expect(describedJson).not.toContain(baseCanary)
    expect(describedJson).not.toContain(userCanary)

    const reset = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsReset, {
      version: 1,
      namespace: 'clawdsh-embeddings-ark',
      expectedRevision: 7,
    })
    expect(reset).toMatchObject({
      ok: true,
      value: {
        namespace: {
          desiredRevision: 8,
          runtimeRevision: 7,
          restartRequired: false,
        },
      },
    })
    expect(replace).toHaveBeenCalledOnce()
    if (reset?.ok !== true || !('namespace' in reset.value)) {
      throw new Error('expected projected settings reset')
    }
    expect(reset.value.namespace.value).not.toHaveProperty('managedSecret')
    expect(reset.value.namespace.base).not.toHaveProperty('managedSecret')
    const resetJson = JSON.stringify(reset)
    expect(resetJson).not.toContain('apiKey')
    expect(resetJson).not.toContain(valueCanary)
    expect(resetJson).not.toContain(baseCanary)
    expect(resetJson).not.toContain(userCanary)
  })

  it('compares desired and captured runtime values instead of revisions', async () => {
    const schema = z.object({ enabled: z.boolean().default(true) })
    let current = descriptor('clawdsh-memory', schema, { enabled: true }, 0, { enabled: true })
    const settings = {
      describe: vi.fn(() => [current]),
      mutate: vi.fn(async (_ns: unknown, ops: Array<{ op: string; path: string[]; value?: unknown }>, expected: number) => {
        if (expected !== current.revision) {
          throw new SettingsConflictError(settingsNamespace('clawdsh-memory'), expected, current.revision)
        }
        const enabled = ops[0]?.op === 'set' ? Boolean(ops[0].value) : true
        current = descriptor(
          'clawdsh-memory',
          schema,
          { enabled },
          current.revision + 1,
          { enabled: true },
          enabled ? undefined : { enabled: false },
        )
      }),
      replace: vi.fn(async (_ns: unknown, _section: object, expected: number) => {
        if (expected !== current.revision) {
          throw new SettingsConflictError(settingsNamespace('clawdsh-memory'), expected, current.revision)
        }
        current = descriptor(
          'clawdsh-memory',
          schema,
          { enabled: true },
          current.revision + 1,
          { enabled: true },
        )
      }),
    }
    const control = readyControl({ settings })

    const changed = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'], value: false }],
    })
    expect(changed).toMatchObject({
      ok: true,
      value: { namespace: { desiredRevision: 1, runtimeRevision: 0, restartRequired: true } },
    })

    const reset = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsReset, {
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 1,
    })
    expect(reset).toMatchObject({
      ok: true,
      value: { namespace: { desiredRevision: 2, runtimeRevision: 0, restartRequired: false } },
    })
  })

  it('commits a multi-field transition as one atomic Settings mutation', async () => {
    const schema = z.object({
      enabled: z.boolean().default(true),
      source: z.string().default(''),
      text: z.string().default(''),
      mode: z.union([z.const('append'), z.const('replace')]).default('append'),
      includeRuntimeContext: z.boolean().default(true),
    })
    let current = descriptor(
      'clawdsh-soul',
      schema,
      { enabled: true, source: '/managed/SOUL.md', text: '', mode: 'append', includeRuntimeContext: true },
      0,
      { source: '/managed/SOUL.md' },
    )
    const mutate = vi.fn(async (_ns: unknown, operations: unknown[], expected: number) => {
      expect(expected).toBe(0)
      expect(operations).toEqual([
        { op: 'set', path: ['source'], value: '' },
        { op: 'set', path: ['text'], value: 'replacement soul' },
      ])
      current = descriptor(
        'clawdsh-soul',
        schema,
        { enabled: true, source: '', text: 'replacement soul', mode: 'append', includeRuntimeContext: true },
        1,
        { source: '/managed/SOUL.md' },
        { source: '', text: 'replacement soul' },
      )
    })
    const control = readyControl({
      settings: { describe: () => [current], mutate },
    })

    const result = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-soul',
      expectedRevision: 0,
      operations: [
        { op: 'set', path: ['source'], value: '' },
        { op: 'set', path: ['text'], value: 'replacement soul' },
      ],
    })

    expect(result).toMatchObject({ ok: true, value: { namespace: { desiredRevision: 1 } } })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('rejects managed paths and maps stale revisions without writing', async () => {
    const schema = z.object({
      ownerPreset: z.string().default('clawdsh'),
      cwd: z.string().default('/workspace'),
    })
    const current = descriptor(
      'clawdsh-channel-agent',
      schema,
      { ownerPreset: 'clawdsh', cwd: '/workspace' },
      4,
    )
    const mutate = vi.fn(async (_ns: unknown, _operations: unknown[], expected: number) => {
      throw new SettingsConflictError(settingsNamespace('clawdsh-channel-agent'), expected, 5)
    })
    const control = readyControl({
      settings: { describe: () => [current], mutate },
    })

    const managed = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-channel-agent',
      expectedRevision: 4,
      operations: [{ op: 'set', path: ['ownerPreset'], value: 'unsafe' }],
    })
    expect(managed).toMatchObject({ ok: false, error: { code: 'settings-rejected' } })
    expect(mutate).not.toHaveBeenCalled()

    const stale = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-channel-agent',
      expectedRevision: 3,
      operations: [{ op: 'set', path: ['cwd'], value: '/another-workspace' }],
    })
    expect(stale).toMatchObject({
      ok: false,
      error: {
        code: 'settings-conflict',
        details: { ns: 'clawdsh-channel-agent', expected: 3, actual: 4 },
      },
    })
    expect(mutate).not.toHaveBeenCalled()

    const raced = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-channel-agent',
      expectedRevision: 4,
      operations: [{ op: 'set', path: ['cwd'], value: '/another-workspace' }],
    })
    expect(raced).toMatchObject({
      ok: false,
      error: {
        code: 'settings-conflict',
        details: { ns: 'clawdsh-channel-agent', expected: 4, actual: 5 },
      },
    })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('rejects unknown nested fields against the registered namespace schema', async () => {
    const schema = z.object({
      enabled: z.boolean().default(false),
      rules: z.array(z.object({ id: z.string().required() })).default([]),
    })
    const current = descriptor(
      'clawdsh-automation',
      schema,
      { enabled: false, rules: [] },
      0,
    )
    const mutate = vi.fn(async () => undefined)
    const control = readyControl({
      settings: { describe: () => [current], mutate },
    })

    const result = await control.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-automation',
      expectedRevision: 0,
      operations: [{
        op: 'set',
        path: ['rules'],
        value: [{ id: 'daily', unknown: 'must-not-persist' }],
      }],
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'settings-rejected' } })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('preflights Gateway enablement before persistence and leaves revision unchanged on failure', async () => {
    const schema = z.object({
      enabled: z.boolean().default(false),
      gatewayPort: z.number().default(18_789),
    })
    let current = descriptor(
      'clawdsh-channel-openclaw',
      schema,
      { enabled: false, gatewayPort: 18_789 },
      0,
    )
    const mutate = vi.fn(async () => {
      current = descriptor(
        'clawdsh-channel-openclaw',
        schema,
        { enabled: true, gatewayPort: 18_789 },
        1,
        undefined,
        { enabled: true },
      )
    })
    const settings = { describe: () => [current], mutate }
    const unavailable = readyControl({ settings })

    const refused = await unavailable.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-channel-openclaw',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'], value: true }],
    })
    expect(refused).toMatchObject({ ok: false, error: { code: 'settings-rejected' } })
    expect(mutate).not.toHaveBeenCalled()
    expect(current.revision).toBe(0)

    const validateDesired = vi.fn(async () => undefined)
    const available = readyControl({
      settings,
      clawdshOpenClawControl: { validateDesired },
    })
    const accepted = await available.handle(CLAWDSH_RPC_ENDPOINTS.settingsMutate, {
      version: 1,
      namespace: 'clawdsh-channel-openclaw',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'], value: true }],
    })
    expect(accepted).toMatchObject({ ok: true, value: { namespace: { desiredRevision: 1 } } })
    expect(validateDesired).toHaveBeenCalledBefore(mutate)
    expect(validateDesired).toHaveBeenCalledWith({ enabled: true, gatewayPort: 18_789 })
  })
})

describe('ClawDSH Credentials control', () => {
  it('exposes only Ark state and never returns the credential value', async () => {
    let configured = false
    let stored: string | undefined
    const credentials = {
      describe: vi.fn(async () => ({ configured, writable: true, ...(configured ? { source: 'file' } : {}) })),
      set: vi.fn(async (_ref: unknown, value: string) => {
        stored = value
        configured = true
      }),
      unset: vi.fn(async () => {
        stored = undefined
        configured = false
      }),
    }
    const control = readyControl({ credentials })

    const catalog = await control.handle(CLAWDSH_RPC_ENDPOINTS.credentialsDescribe, CLAWDSH_READ_REQUEST)
    expect(catalog).toMatchObject({
      ok: true,
      value: { credentials: [{ id: 'ark-api-key', configured: false, writable: true }] },
    })

    const secret = 'rpc-secret-canary-71d11d'
    const set = await control.handle(CLAWDSH_RPC_ENDPOINTS.credentialsSet, {
      version: 1,
      id: 'ark-api-key',
      value: secret,
    })
    expect(stored).toBe(secret)
    expect(set).toMatchObject({ ok: true, value: { credential: { configured: true, source: 'file' } } })
    expect(JSON.stringify(set)).not.toContain(secret)

    const forbidden = await control.handle(CLAWDSH_RPC_ENDPOINTS.credentialsSet, {
      version: 1,
      id: 'feishu-secret',
      value: secret,
    })
    expect(forbidden).toMatchObject({
      ok: false,
      error: { code: 'credential-rejected', details: { ref: 'unknown' } },
    })
    expect(JSON.stringify(forbidden)).not.toContain('feishu-secret')
    expect(credentials.set).toHaveBeenCalledOnce()
  })
})
