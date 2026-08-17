import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  environmentNames,
  inspectLegacyChannelConfiguration,
  parseArguments,
} from './openclaw-channel-migration.ts'

describe('OpenClaw channel migration inventory', () => {
  it('reports only credential names and legacy adapter references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawdsh-channel-migration-'))
    const profile = join(root, 'cordis.patch.yml')
    const secret = 'must-not-appear-in-report'
    await writeFile(profile, [
      "name: '@clawdsh/dsh-channel-feishu'",
      `FEISHU_APP_SECRET=${secret}`,
      'TELEGRAM_BOT_TOKEN=another-secret',
    ].join('\n'))
    const report = await inspectLegacyChannelConfiguration([profile], {
      FEISHU_APP_ID: secret,
      UNRELATED_SECRET: secret,
    })
    const serialized = JSON.stringify(report)
    expect(report.legacyAdaptersDetected).toEqual(['feishu'])
    expect(report.inputs[0]?.environmentNames).toEqual(['FEISHU_APP_SECRET', 'TELEGRAM_BOT_TOKEN'])
    expect(report.processEnvironmentNames).toEqual(['FEISHU_APP_ID'])
    expect(report.copiedSecrets).toBe(false)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('UNRELATED_SECRET')
  })

  it('parses exported assignments and validates explicit input arguments', () => {
    expect(environmentNames('export A=1\n B = two\n# C=3\n')).toEqual(['A', 'B'])
    expect(parseArguments(['--input', './profile.yml'])).toEqual([resolveForTest('./profile.yml')])
    expect(() => parseArguments([])).toThrow('at least one')
    expect(() => parseArguments(['--other'])).toThrow('unknown argument')
    expect(() => parseArguments(['--input'])).toThrow('requires a path')
  })

  it('mounts the sidecar and its invariant companions while the Gateway remains disabled', async () => {
    const profile = await readFile(fileURLToPath(new URL(
      '../packages/openclaw/preset-openclaw/profile/dev-bundle/cordis.patch.yml',
      import.meta.url,
    )), 'utf8')
    expect(profile).toContain("- id: clawdsh-communication-plane")
    expect(profile).not.toContain("disabled: !!js process.env.CLAWDSH_OPENCLAW_CHANNELS_ENABLED")
    expect(profile).toMatch(/- id: channel-openclaw[\s\S]*?config:\n            enabled: false/)
    for (const packageName of [
      '@deepseek-ai/dsh-invariants',
      '@clawdsh/dsh-channel',
      '@clawdsh/dsh-channel/invariant',
      '@clawdsh/dsh-channel-agent',
      '@clawdsh/dsh-channel-agent/invariant',
      '@clawdsh/dsh-channel-openclaw',
      '@clawdsh/dsh-channel-openclaw/invariant',
    ]) {
      expect(profile.match(new RegExp(`name: '${packageName.replaceAll('/', '\\/')}'`, 'g'))).toHaveLength(1)
    }
  })
})

function resolveForTest(path: string): string {
  return join(process.cwd(), path.slice(2))
}
