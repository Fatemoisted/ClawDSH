import { describe, expect, it } from 'vitest'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import * as PresetInvariant from '../src/invariant.ts'

describe('messaging-safe preset invariant companion', () => {
  it('registers the static package under its exact package identity', async () => {
    let installer: InvariantInstaller | undefined
    const register = (packageName: string, candidate: InvariantInstaller) => {
      expect(packageName).toBe('@clawdsh/dsh-preset-messaging-safe')
      installer = candidate
      return () => {}
    }

    const disposer = await PresetInvariant.apply({ invariants: { register } } as never)
    expect(PresetInvariant.name).toBe('clawdsh-messaging-safe-preset-invariant')
    expect(PresetInvariant.inject).toEqual(['invariants'])
    expect(disposer).toBeTypeOf('function')
    expect(installer).toBeTypeOf('function')
    await installer?.({} as never, (message) => { throw new Error(message) })
  })
})
