import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { releaseFamily } from './families.ts'
import { verifyPrivateRegistryUrl, verifyReleaseBranch } from './verify.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('release publication gates', () => {
  it('accepts only credential-free private HTTPS registry URLs', () => {
    for (const registry of [
      'https://npm.internal.example/',
      'https://packages.example.test/npm/',
      'https://registry.example.test:8443/',
    ]) {
      expect(() => { verifyPrivateRegistryUrl(registry) }).not.toThrow()
    }

    for (const registry of [
      '',
      ' https://npm.internal.example/',
      'https://npm.internal.example/ ',
      'http://npm.internal.example/',
      'registry.example.test',
      'https://./',
      'https://-/',
      'https://user:secret@npm.internal.example/',
      'https://npm.internal.example/?tenant=clawdsh',
      'https://npm.internal.example/#clawdsh',
      'https://registry.npmjs.org/',
      'https://REGISTRY.NPMJS.ORG./',
    ]) {
      expect(() => { verifyPrivateRegistryUrl(registry) }, registry).toThrow()
    }
  })

  it('requires the tagged HEAD to be contained in the remote release branch', () => {
    const root = createGitRepository()
    try {
      const family = releaseFamily('clawdsh')
      git(root, 'update-ref', 'refs/remotes/origin/clawdsh', 'HEAD')
      expect(() => { verifyReleaseBranch(family, root) }).not.toThrow()

      writeFileSync(join(root, 'feature.txt'), 'not merged\n')
      git(root, 'add', 'feature.txt')
      git(root, 'commit', '--quiet', '-m', 'feature commit')
      expect(() => { verifyReleaseBranch(family, root) }).toThrow(/contained in origin\/clawdsh/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed when the remote release branch is unavailable', () => {
    const root = createGitRepository()
    try {
      expect(() => { verifyReleaseBranch(releaseFamily('clawdsh'), root) })
        .toThrow(/could not verify origin\/clawdsh ancestry/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ClawDSH publish workflow', () => {
  it('keeps the target registry protected and proves a registry-realistic install before publish', () => {
    const source = readFileSync(resolve(repositoryRoot, '.github/workflows/clawdsh-publish.yml'), 'utf8')
    const workflow = record(yaml.load(source), 'workflow')
    const events = record(workflow.on, 'workflow events')
    const dispatch = record(events.workflow_dispatch, 'workflow dispatch')
    const inputs = record(dispatch.inputs, 'workflow inputs')
    expect(inputs).not.toHaveProperty('registry')
    expect(source).not.toContain('inputs.registry')

    const jobs = record(workflow.jobs, 'workflow jobs')
    const pack = record(jobs.pack, 'pack job')
    const publish = record(jobs.publish, 'publish job')
    expect(publish.environment).toBe('npm-publish')

    const packSteps = records(pack.steps, 'pack steps')
    expect(stepNamed(packSteps, 'Verify runtime dependency closure').run).toBe('pnpm run verify-runtime-closure')
    expect(stepNamed(packSteps, 'Clean generated outputs').run).toBe('pnpm run clean')

    const steps = records(publish.steps, 'publish steps')
    const checkout = steps.find(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
    expect(checkout).toMatchObject({ with: { 'fetch-depth': 0, 'persist-credentials': false } })

    const installIndex = stepIndex(steps, 'Install release scripts only')
    const gateIndex = stepIndex(steps, 'Re-verify publish gates and protected private registry')
    const registryIndex = stepIndex(steps, 'Configure authenticated private registry')
    const smokeIndex = stepIndex(steps, 'Verify target-registry fresh install')
    const publishIndex = stepIndex(steps, 'Publish the exact verified tarballs')
    expect(installIndex).toBeLessThan(gateIndex)
    expect(gateIndex).toBeLessThan(registryIndex)
    expect(registryIndex).toBeLessThan(smokeIndex)
    expect(smokeIndex).toBeLessThan(publishIndex)

    expect(steps[installIndex]).toMatchObject({
      env: { NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org' },
      run: 'pnpm install --frozen-lockfile --ignore-scripts',
    })
    expect(steps[gateIndex]).toMatchObject({
      env: {
        RELEASE_PUBLISH: 'true',
        TARGET_REGISTRY: '${{ vars.NPM_REGISTRY_URL }}',
      },
    })
    expect(steps[gateIndex]?.run).toContain('--registry "$TARGET_REGISTRY"')
    expect(steps[registryIndex]).toMatchObject({
      with: {
        'registry-url': '${{ vars.NPM_REGISTRY_URL }}',
        'always-auth': true,
      },
    })

    const smoke = steps[smokeIndex]
    expect(smoke?.run).toContain('--from dist/npm-clawdsh')
    expect(smoke?.run).not.toContain('dist/npm-dsh')
    expect(smoke?.run).not.toContain('dist/npm-vendor')
    expect(smoke?.run).not.toContain('dist/npm-landlock')
    expect(smoke).toMatchObject({
      env: {
        NPM_CONFIG_REGISTRY: '${{ vars.NPM_REGISTRY_URL }}',
        NODE_AUTH_TOKEN: '${{ secrets.NPM_READ_TOKEN }}',
      },
    })
    expect(JSON.stringify(steps.slice(0, publishIndex))).not.toContain('secrets.NPM_TOKEN')
    expect(steps[publishIndex]).toMatchObject({
      env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' },
    })
  })
})

function createGitRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'release-verify-'))
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.email', 'release-test@example.test')
  git(root, 'config', 'user.name', 'Release Test')
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git(root, 'add', 'base.txt')
  git(root, 'commit', '--quiet', '-m', 'base')
  return root
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' })
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value.map((entry, index) => record(entry, `${label}[${String(index)}]`))
}

function stepNamed(steps: readonly Record<string, unknown>[], name: string): Record<string, unknown> {
  const step = steps.find(candidate => candidate.name === name)
  if (step === undefined) throw new TypeError(`workflow must define step ${name}`)
  return step
}

function stepIndex(steps: readonly Record<string, unknown>[], name: string): number {
  const index = steps.findIndex(step => step.name === name)
  if (index === -1) throw new TypeError(`workflow must define step ${name}`)
  return index
}
