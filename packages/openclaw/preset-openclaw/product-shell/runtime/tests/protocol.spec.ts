import { describe, expect, it } from 'vitest'
import {
  parseClawdshCredentialResponse,
  parseClawdshCredentialSetRequest,
  parseClawdshCredentialUnsetRequest,
  parseClawdshSettingsMutateRequest,
} from '../../shared/src/protocol.ts'

describe('ClawDSH mutable protocol boundary', () => {
  it('rejects unknown fields and prototype-pollution paths', () => {
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'], value: true }],
      extra: true,
    })).toThrow('unknown field')
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['__proto__', 'enabled'], value: true }],
    })).toThrow('invalid segment')
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{
        op: 'set',
        path: ['enabled'],
        value: JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as unknown,
      }],
    })).toThrow('forbidden object key')
  })

  it('enforces the set and unset request forms exactly', () => {
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'set', path: ['enabled'] }],
    })).toThrow('missing value')
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [{ op: 'unset', path: ['enabled'], value: false }],
    })).toThrow('must not contain value')
  })

  it('requires a bounded non-empty batch with distinct paths', () => {
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [],
    })).toThrow('non-empty array')
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: [
        { op: 'set', path: ['enabled'], value: true },
        { op: 'unset', path: ['enabled'] },
      ],
    })).toThrow('must not repeat a path')
    expect(() => parseClawdshSettingsMutateRequest({
      version: 1,
      namespace: 'clawdsh-memory',
      expectedRevision: 0,
      operations: Array.from({ length: 65 }, (_, index) => ({
        op: 'set',
        path: [`field-${String(index)}`],
        value: index,
      })),
    })).toThrow('at most 64')
  })

  it('keeps credential writes strict and credential responses write-only', () => {
    expect(parseClawdshCredentialSetRequest({ version: 1, id: 'ark-api-key', value: 'canary' }))
      .toEqual({ version: 1, id: 'ark-api-key', value: 'canary' })
    expect(parseClawdshCredentialUnsetRequest({ version: 1, id: 'ark-api-key' }))
      .toEqual({ version: 1, id: 'ark-api-key' })
    expect(() => parseClawdshCredentialSetRequest({
      version: 1,
      id: 'ark-api-key',
      value: 'canary',
      returnValue: true,
    })).toThrow('unknown field')
    expect(() => parseClawdshCredentialResponse({
      version: 1,
      credential: {
        id: 'ark-api-key',
        label: 'Ark API Key',
        configured: true,
        writable: true,
        effectTime: 'next-call',
        value: 'must-not-cross-the-wire',
      },
    })).toThrow('unknown field')
  })
})
