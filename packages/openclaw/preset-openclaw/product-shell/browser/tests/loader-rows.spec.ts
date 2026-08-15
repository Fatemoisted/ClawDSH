import { describe, expect, it } from 'vitest'
import type { BootManifest } from '@deepseek-ai/dsh-client-modules/client'
import { CLAWDSH_APP_SHELL_ID, CLIENT_MODULES_ID, clawdshLoaderRows } from '../src/loader-rows.ts'

function manifest(ids: readonly string[]): BootManifest {
  return {
    rev: 'fixture',
    modules: ids.map(id => ({ id, url: `/plugins/${id}`, rev: 'one' })),
    plugins: ids.map(id => ({ id, inject: [], immediately: false })),
  }
}

describe('ClawDSH browser Loader composition', () => {
  it('adopts modules first, retains every Host plugin, and mounts its assembly last', () => {
    const hostIds = [CLIENT_MODULES_ID, '@deepseek-ai/dsh-client-runtime', '@community/example']
    const rows = clawdshLoaderRows(manifest(hostIds))

    expect(rows).toEqual([
      CLIENT_MODULES_ID,
      '@deepseek-ai/dsh-client-runtime',
      '@community/example',
      CLAWDSH_APP_SHELL_ID,
    ])
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('rejects a Host graph that claims the shell-owned assembly id', () => {
    expect(() => clawdshLoaderRows(manifest([CLAWDSH_APP_SHELL_ID])))
      .toThrow('must not claim reserved entry')
  })
})
