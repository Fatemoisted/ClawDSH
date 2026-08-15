import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  validateExtensionLocks,
  verifyExtensionInstallations,
  verifyExtensionRuntimeInspection,
  type OpenClawExtensionLock,
} from '../src/extensions.ts'
import { installedProjectTreeDigest } from '../src/file-integrity.ts'

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`
const roots: string[] = []

interface ExtensionFixture {
  readonly root: string
  readonly stateDir: string
  readonly hostRoot: string
  readonly projectRoot: string
  readonly packageRoot: string
  readonly checkedLockPath: string
  readonly hiddenLockPath: string
  readonly lock: OpenClawExtensionLock
}

interface NpmLock {
  name: string
  lockfileVersion: number
  packages: Record<string, Record<string, unknown>>
}

afterEach(async () => {
  await Promise.allSettled(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function extensionLock(overrides: Partial<OpenClawExtensionLock> = {}): OpenClawExtensionLock {
  return {
    pluginId: 'qqbot',
    channelIds: ['qq'],
    packageName: '@openclaw/qqbot',
    version: '1.2.3',
    integrity: INTEGRITY,
    projectTree: { fileCount: 1, sha512: '0'.repeat(128) },
    ...overrides,
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'channel-openclaw-extensions-'))
  roots.push(root)
  return root
}

function primaryEntry(lock: OpenClawExtensionLock): Record<string, unknown> {
  return {
    version: lock.version,
    resolved: `https://registry.npmjs.org/${lock.packageName}/-/${lock.pluginId}-${lock.version}.tgz`,
    integrity: lock.integrity,
  }
}

async function extensionFixture(requestedLock: OpenClawExtensionLock = extensionLock()): Promise<ExtensionFixture> {
  const root = await temporaryRoot()
  const stateDir = join(root, 'state')
  const hostRoot = join(root, 'host')
  const projectRoot = join(stateDir, 'npm', 'projects', requestedLock.pluginId)
  const packageRoot = join(projectRoot, 'node_modules', ...requestedLock.packageName.split('/'))
  const checkedLockPath = join(projectRoot, 'package-lock.json')
  const hiddenLockPath = join(projectRoot, 'node_modules', '.package-lock.json')
  const entry = primaryEntry(requestedLock)
  const packages = {
    '': { dependencies: { [requestedLock.packageName]: requestedLock.version } },
    [`node_modules/${requestedLock.packageName}`]: entry,
  }
  await mkdir(packageRoot, { recursive: true })
  await mkdir(hostRoot)
  await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
    name: 'clawdsh-extension-qqbot',
    private: true,
    dependencies: { [requestedLock.packageName]: requestedLock.version },
  }))
  await writeFile(checkedLockPath, JSON.stringify({
    name: 'clawdsh-extension-qqbot', lockfileVersion: 3, packages,
  }))
  await writeFile(hiddenLockPath, JSON.stringify({
    name: 'clawdsh-extension-qqbot',
    lockfileVersion: 3,
    packages: { [`node_modules/${requestedLock.packageName}`]: entry },
  }))
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: requestedLock.packageName, version: requestedLock.version,
  }))
  await writeFile(join(packageRoot, 'index.js'), 'export const channel = true\n')
  const lock = { ...requestedLock, projectTree: await installedProjectTreeDigest(projectRoot) }
  return { root, stateDir, hostRoot, projectRoot, packageRoot, checkedLockPath, hiddenLockPath, lock }
}

async function readLock(path: string): Promise<NpmLock> {
  return JSON.parse(await readFile(path, 'utf8')) as NpmLock
}

async function mutateLock(path: string, mutate: (lock: NpmLock) => void): Promise<void> {
  const lock = await readLock(path)
  mutate(lock)
  await writeFile(path, JSON.stringify(lock))
}

function runtimeInspection(lock: OpenClawExtensionLock, rootDir: string): Record<string, unknown> {
  const exactSpec = `${lock.packageName}@${lock.version}`
  return {
    plugin: {
      id: lock.pluginId,
      packageName: lock.packageName,
      version: lock.version,
      status: 'loaded',
      imported: true,
      enabled: true,
      explicitlyEnabled: true,
      activated: true,
      origin: 'global',
      trustedOfficialInstall: true,
      configSchema: true,
      error: null,
      channelIds: [...lock.channelIds],
      rootDir,
    },
    capabilities: [{ kind: 'channel', ids: [...lock.channelIds] }],
    diagnostics: [],
    compatibility: [],
    install: {
      source: 'npm',
      spec: exactSpec,
      resolvedSpec: exactSpec,
      resolvedName: lock.packageName,
      version: lock.version,
      resolvedVersion: lock.version,
      integrity: lock.integrity,
      installPath: rootDir,
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('extension lock validation', () => {
  it('accepts exact scoped and unscoped package locks', () => {
    expect(() => {
      validateExtensionLocks([
        extensionLock(),
        extensionLock({
          pluginId: 'zalo-personal',
          channelIds: ['zalo-personal'],
          packageName: 'openclaw-zalo-personal',
        }),
      ])
    }).not.toThrow()
  })

  it.each([
    ['reserved plugin id', [extensionLock({ pluginId: 'clawdsh-bridge' })]],
    ['invalid plugin id', [extensionLock({ pluginId: '-bad' })]],
    ['duplicate plugin id', [extensionLock(), extensionLock({ packageName: '@openclaw/other' })]],
    ['invalid package name', [extensionLock({ packageName: '@openclaw' })]],
    ['duplicate package', [extensionLock(), extensionLock({ pluginId: 'other' })]],
    ['version range', [extensionLock({ version: '^1.2.3' })]],
    ['wrong SRI algorithm', [extensionLock({ integrity: `sha256-${Buffer.alloc(64).toString('base64')}` })]],
    ['wrong SRI length', [extensionLock({ integrity: `sha512-${Buffer.alloc(8).toString('base64')}` })]],
    ['missing project tree lock', [{ ...extensionLock(), projectTree: undefined } as unknown as OpenClawExtensionLock]],
    ['zero project tree files', [extensionLock({ projectTree: { fileCount: 0, sha512: '0'.repeat(128) } })]],
    ['invalid project tree digest', [extensionLock({ projectTree: { fileCount: 1, sha512: 'A'.repeat(128) } })]],
    ['empty Channel ids', [extensionLock({ channelIds: [] })]],
    ['duplicate Channel ids', [extensionLock({ channelIds: ['qq', 'qq'] })]],
    ['invalid Channel id', [extensionLock({ channelIds: ['QQ'] })]],
  ] as const)('rejects %s', (_label, locks) => {
    expect(() => { validateExtensionLocks(locks) }).toThrow(/channel-openclaw/)
  })
})

describe('extension installation verification', () => {
  it('accepts no installation root only when no extensions are locked', async () => {
    const root = await temporaryRoot()
    const stateDir = join(root, 'state')
    const hostRoot = join(root, 'host')
    await mkdir(stateDir)
    await mkdir(hostRoot)
    await expect(verifyExtensionInstallations([], stateDir, hostRoot)).resolves.toEqual(new Map())
    await expect(verifyExtensionInstallations([extensionLock()], stateDir, hostRoot)).rejects.toThrow()
  })

  it('returns the canonical package root for an exact checked installation', async () => {
    const fixture = await extensionFixture()
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
      .resolves.toEqual(new Map([['qqbot', await realpath(fixture.packageRoot)]]))
  })

  it('rejects primary package code changed after the tree was locked', async () => {
    const fixture = await extensionFixture()
    await writeFile(join(fixture.packageRoot, 'index.js'), 'export const channel = false\n')
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/isolated npm project tree differs/)
  })

  it('locks the ordinary-file bytes of every transitive dependency', async () => {
    const fixture = await extensionFixture()
    const dependencyPath = 'node_modules/dependency'
    const dependency = {
      version: '4.5.6',
      resolved: 'https://registry.npmjs.org/dependency/-/dependency-4.5.6.tgz',
      integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
    }
    await mutateLock(fixture.checkedLockPath, (lock) => { lock.packages[dependencyPath] = dependency })
    await mutateLock(fixture.hiddenLockPath, (lock) => { lock.packages[dependencyPath] = dependency })
    const dependencyRoot = join(fixture.projectRoot, dependencyPath)
    await mkdir(dependencyRoot)
    await writeFile(join(dependencyRoot, 'package.json'), JSON.stringify({
      name: 'dependency', version: dependency.version,
    }))
    await writeFile(join(dependencyRoot, 'index.js'), 'export const dependency = true\n')
    const lock = {
      ...fixture.lock,
      projectTree: await installedProjectTreeDigest(fixture.projectRoot),
    }
    await expect(verifyExtensionInstallations([lock], fixture.stateDir, fixture.hostRoot))
      .resolves.toBeInstanceOf(Map)

    await writeFile(join(dependencyRoot, 'index.js'), 'export const dependency = false\n')
    await expect(verifyExtensionInstallations([lock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/isolated npm project tree differs/)
  })

  it('verifies an unscoped extension package identity', async () => {
    const fixture = await extensionFixture(extensionLock({
      pluginId: 'zalo', channelIds: ['zalo'], packageName: 'openclaw-zalo',
    }))
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
      .resolves.toEqual(new Map([['zalo', await realpath(fixture.packageRoot)]]))
  })

  it('allows only an OpenClaw peer symlink resolving to the verified host', async () => {
    const fixture = await extensionFixture()
    const nested = join(fixture.packageRoot, 'node_modules')
    await mkdir(nested)
    const peer = join(nested, 'openclaw')
    await symlink(fixture.hostRoot, peer)
    const peerLock = {
      ...fixture.lock,
      projectTree: await installedProjectTreeDigest(fixture.projectRoot, [peer]),
    }
    await expect(verifyExtensionInstallations([peerLock], fixture.stateDir, fixture.hostRoot)).resolves.toBeInstanceOf(Map)

    await rm(join(nested, 'openclaw'))
    const other = join(fixture.root, 'other-host')
    await mkdir(other)
    await symlink(other, join(nested, 'openclaw'))
    await expect(verifyExtensionInstallations([peerLock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/does not target/)

    await rm(join(nested, 'openclaw'))
    await mkdir(join(nested, 'openclaw'))
    await expect(verifyExtensionInstallations([peerLock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/does not target/)
  })

  it('rejects relative roots, escaped project roots, and unsafe project entries', async () => {
    const fixture = await extensionFixture()
    await expect(verifyExtensionInstallations([fixture.lock], 'relative', fixture.hostRoot)).rejects.toThrow(/must be absolute/)
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, 'relative')).rejects.toThrow(/must be absolute/)

    const linked = await temporaryRoot()
    const linkedState = join(linked, 'state')
    const outside = join(linked, 'outside')
    await mkdir(join(linkedState, 'npm'), { recursive: true })
    await mkdir(outside)
    await symlink(outside, join(linkedState, 'npm', 'projects'))
    await expect(verifyExtensionInstallations([], linkedState, fixture.hostRoot)).rejects.toThrow()

    const linkedParent = await temporaryRoot()
    const parentState = join(linkedParent, 'state')
    const outsideParent = join(linkedParent, 'outside')
    await mkdir(parentState)
    await mkdir(join(outsideParent, 'projects'), { recursive: true })
    await symlink(outsideParent, join(parentState, 'npm'))
    await expect(verifyExtensionInstallations([], parentState, fixture.hostRoot))
      .rejects.toThrow(/escapes stateDir/)

    await writeFile(join(fixture.stateDir, 'npm', 'projects', 'not-a-project'), 'file')
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/non-directory entry/)
  })

  it('rejects untracked, duplicate, and absent locked projects', async () => {
    const fixture = await extensionFixture()
    await expect(verifyExtensionInstallations([], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/untracked or duplicate/)

    await cp(fixture.projectRoot, join(fixture.stateDir, 'npm', 'projects', 'duplicate'), { recursive: true })
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
      .rejects.toThrow(/untracked or duplicate/)

    const absentRoot = await temporaryRoot()
    const stateDir = join(absentRoot, 'state')
    const hostRoot = join(absentRoot, 'host')
    await mkdir(join(stateDir, 'npm', 'projects'), { recursive: true })
    await mkdir(hostRoot)
    await expect(verifyExtensionInstallations([fixture.lock], stateDir, hostRoot))
      .rejects.toThrow(/is not installed/)
  })

  it('rejects mutable project declarations and malformed npm locks', async () => {
    const project = await extensionFixture()
    await writeFile(join(project.projectRoot, 'package.json'), JSON.stringify({
      private: false, dependencies: { [project.lock.packageName]: project.lock.version },
    }))
    await expect(verifyExtensionInstallations([project.lock], project.stateDir, project.hostRoot))
      .rejects.toThrow(/does not pin/)

    const dependencyCount = await extensionFixture()
    await writeFile(join(dependencyCount.projectRoot, 'package.json'), JSON.stringify({
      private: true, dependencies: {},
    }))
    await expect(verifyExtensionInstallations(
      [dependencyCount.lock], dependencyCount.stateDir, dependencyCount.hostRoot,
    )).rejects.toThrow(/exactly one package/)

    const malformed = await extensionFixture()
    await writeFile(malformed.checkedLockPath, '{')
    await expect(verifyExtensionInstallations([malformed.lock], malformed.stateDir, malformed.hostRoot))
      .rejects.toThrow(/strict JSON/)

    const identity = await extensionFixture()
    await mutateLock(identity.hiddenLockPath, (lock) => { lock.name = 'other' })
    await expect(verifyExtensionInstallations([identity.lock], identity.stateDir, identity.hostRoot))
      .rejects.toThrow(/unexpected identity or format/)

    const rootPin = await extensionFixture()
    await mutateLock(rootPin.checkedLockPath, (lock) => { lock.packages[''] = { dependencies: {} } })
    await expect(verifyExtensionInstallations([rootPin.lock], rootPin.stateDir, rootPin.hostRoot))
      .rejects.toThrow(/checked lock does not pin/)
  })

  it('rejects primary lock identity and on-disk metadata drift', async () => {
    const checked = await extensionFixture()
    await mutateLock(checked.checkedLockPath, (lock) => {
      lock.packages[`node_modules/${checked.lock.packageName}`]!.integrity = `sha512-${Buffer.alloc(64, 8).toString('base64')}`
    })
    await expect(verifyExtensionInstallations([checked.lock], checked.stateDir, checked.hostRoot))
      .rejects.toThrow(/checked primary/)

    const hidden = await extensionFixture()
    await mutateLock(hidden.hiddenLockPath, (lock) => {
      lock.packages[`node_modules/${hidden.lock.packageName}`]!.resolved = 'https://registry.npmjs.org/other/-/other.tgz'
    })
    await expect(verifyExtensionInstallations([hidden.lock], hidden.stateDir, hidden.hostRoot))
      .rejects.toThrow(/differs from its checked lock/)

    const metadata = await extensionFixture()
    await writeFile(join(metadata.packageRoot, 'package.json'), JSON.stringify({
      name: metadata.lock.packageName, version: '0.0.0',
    }))
    await expect(verifyExtensionInstallations([metadata.lock], metadata.stateDir, metadata.hostRoot))
      .rejects.toThrow(/dependency metadata/)
  })

  it('compares checked, installed, and actual dependency sets', async () => {
    const missingActual = await extensionFixture()
    const dependencyPath = 'node_modules/dependency'
    const dependency = {
      version: '4.5.6',
      resolved: 'https://registry.npmjs.org/dependency/-/dependency-4.5.6.tgz',
      integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
    }
    await mutateLock(missingActual.checkedLockPath, (lock) => { lock.packages[dependencyPath] = dependency })
    await mutateLock(missingActual.hiddenLockPath, (lock) => { lock.packages[dependencyPath] = dependency })
    await expect(verifyExtensionInstallations([missingActual.lock], missingActual.stateDir, missingActual.hostRoot))
      .rejects.toThrow(/absent from node_modules/)

    const missingInstalled = await extensionFixture()
    await mutateLock(missingInstalled.checkedLockPath, (lock) => { lock.packages[dependencyPath] = dependency })
    await expect(verifyExtensionInstallations([missingInstalled.lock], missingInstalled.stateDir, missingInstalled.hostRoot))
      .rejects.toThrow(/required dependency/)

    const untracked = await extensionFixture()
    const rogue = join(untracked.projectRoot, 'node_modules', 'rogue')
    await mkdir(rogue)
    await writeFile(join(rogue, 'package.json'), JSON.stringify({ name: 'rogue', version: '1.0.0' }))
    await expect(verifyExtensionInstallations([untracked.lock], untracked.stateDir, untracked.hostRoot))
      .rejects.toThrow(/untracked package/)

    const optional = await extensionFixture()
    await mutateLock(optional.checkedLockPath, (lock) => {
      lock.packages[dependencyPath] = { ...dependency, optional: true }
      lock.packages['node_modules/platform-only'] = { ...dependency, os: [`!${process.platform}`] }
    })
    const optionalLock = {
      ...optional.lock,
      projectTree: await installedProjectTreeDigest(optional.projectRoot),
    }
    await expect(verifyExtensionInstallations([optionalLock], optional.stateDir, optional.hostRoot))
      .resolves.toBeInstanceOf(Map)
  })

  it('rejects malformed package-lock paths and scoped filesystem entries', async () => {
    for (const path of [
      'node_modules//bad',
      'node_modules/pkg/child',
      'node_modules/pkg/node_modules',
      'node_modules/@scope',
    ]) {
      const fixture = await extensionFixture()
      const entry = { version: '1.0.0' }
      await mutateLock(fixture.checkedLockPath, (lock) => { lock.packages[path] = entry })
      await mutateLock(fixture.hiddenLockPath, (lock) => { lock.packages[path] = entry })
      await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot))
        .rejects.toThrow(/differs from its checked lock/)
    }

    const scoped = await extensionFixture()
    await writeFile(join(scoped.projectRoot, 'node_modules', '@openclaw', 'not-a-package'), 'file')
    await expect(verifyExtensionInstallations([scoped.lock], scoped.stateDir, scoped.hostRoot))
      .rejects.toThrow(/scope contains a non-directory/)
  })

  it('rejects a package whose nested node_modules is not an ordinary directory', async () => {
    const fixture = await extensionFixture()
    const path = 'node_modules/dependency'
    const entry = {
      version: '4.5.6',
      resolved: 'https://registry.npmjs.org/dependency/-/dependency-4.5.6.tgz',
      integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
    }
    await mutateLock(fixture.checkedLockPath, (lock) => { lock.packages[path] = entry })
    await mutateLock(fixture.hiddenLockPath, (lock) => { lock.packages[path] = entry })
    const packageRoot = join(fixture.projectRoot, path)
    await mkdir(packageRoot)
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'dependency', version: entry.version }))
    await writeFile(join(packageRoot, 'node_modules'), 'file')
    await expect(verifyExtensionInstallations([fixture.lock], fixture.stateDir, fixture.hostRoot)).rejects.toThrow()
  })

  it('applies npm OS and CPU selectors to missing checked dependencies', async () => {
    const candidates: Array<{ selector: Record<string, unknown>; required: boolean }> = [
      { selector: { os: process.platform }, required: false },
      { selector: { os: [`!${process.platform}`] }, required: false },
      { selector: { os: ['definitely-another-platform'] }, required: false },
      { selector: { os: ['!definitely-another-platform'], cpu: [`!${process.arch}`] }, required: false },
      { selector: { os: ['!definitely-another-platform'], cpu: [process.arch] }, required: true },
    ]
    for (const { selector, required } of candidates) {
      const fixture = await extensionFixture()
      await mutateLock(fixture.checkedLockPath, (lock) => {
        lock.packages['node_modules/platform-dependency'] = {
          version: '1.0.0',
          ...selector,
        }
      })
      const lock = {
        ...fixture.lock,
        projectTree: await installedProjectTreeDigest(fixture.projectRoot),
      }
      const verification = verifyExtensionInstallations([lock], fixture.stateDir, fixture.hostRoot)
      if (required) await expect(verification).rejects.toThrow(/required dependency/)
      else await expect(verification).resolves.toBeInstanceOf(Map)
    }
  })

  it('rejects lock paths and actual entries that are not package directories', async () => {
    const invalidLock = await extensionFixture()
    await mutateLock(invalidLock.checkedLockPath, (lock) => { lock.packages.invalid = { version: '1.0.0' } })
    await mutateLock(invalidLock.hiddenLockPath, (lock) => { lock.packages.invalid = { version: '1.0.0' } })
    await expect(verifyExtensionInstallations([invalidLock.lock], invalidLock.stateDir, invalidLock.hostRoot))
      .rejects.toThrow(/differs from its checked lock/)

    const file = await extensionFixture()
    await writeFile(join(file.projectRoot, 'node_modules', 'rogue'), 'file')
    await expect(verifyExtensionInstallations([file.lock], file.stateDir, file.hostRoot))
      .rejects.toThrow(/non-directory entry/)

    const linked = await extensionFixture()
    await symlink(linked.hostRoot, join(linked.projectRoot, 'node_modules', 'rogue'))
    await expect(verifyExtensionInstallations([linked.lock], linked.stateDir, linked.hostRoot))
      .rejects.toThrow(/unverified package link/)
  })
})

describe('extension runtime inspection', () => {
  it('accepts the exact loaded install and Channel ids in any order', async () => {
    const fixture = await extensionFixture()
    const lock = extensionLock({ channelIds: ['qq', 'qq-group'] })
    const value = runtimeInspection(lock, fixture.packageRoot)
    ;(value.plugin as Record<string, unknown>).channelIds = ['qq-group', 'qq']
    ;(value.capabilities as Array<Record<string, unknown>>)[0]!.ids = ['qq-group', 'qq']
    value.diagnostics = [{ level: 'warning' }]
    value.compatibility = [{ severity: 'info' }]
    await expect(verifyExtensionRuntimeInspection(
      JSON.stringify(value), lock, await realpath(fixture.packageRoot),
    )).resolves.toBeUndefined()
  })

  it('rejects malformed output, missing records, and runtime identity drift', async () => {
    const fixture = await extensionFixture()
    const expectedRoot = await realpath(fixture.packageRoot)
    await expect(verifyExtensionRuntimeInspection('not-json', fixture.lock, expectedRoot)).rejects.toThrow(/strict JSON/)
    await expect(verifyExtensionRuntimeInspection('[]', fixture.lock, expectedRoot)).rejects.toThrow(/must be an object/)

    const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
      ['missing plugin', (value) => { value.plugin = null }],
      ['missing install', (value) => { value.install = null }],
      ['wrong plugin', (value) => { (value.plugin as Record<string, unknown>).id = 'other' }],
      ['wrong package', (value) => { (value.plugin as Record<string, unknown>).packageName = 'other' }],
      ['disabled', (value) => { (value.plugin as Record<string, unknown>).enabled = false }],
      ['not explicit', (value) => { (value.plugin as Record<string, unknown>).explicitlyEnabled = false }],
      ['not activated', (value) => { (value.plugin as Record<string, unknown>).activated = false }],
      ['wrong origin', (value) => { (value.plugin as Record<string, unknown>).origin = 'workspace' }],
      ['untrusted', (value) => { (value.plugin as Record<string, unknown>).trustedOfficialInstall = false }],
      ['plugin error', (value) => { (value.plugin as Record<string, unknown>).error = 'bad' }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(runtimeInspection(fixture.lock, fixture.packageRoot))
      mutate(value)
      await expect(verifyExtensionRuntimeInspection(JSON.stringify(value), fixture.lock, expectedRoot), label)
        .rejects.toThrow(/channel-openclaw/)
    }
  })

  it('rejects unexpected Channels, capabilities, diagnostics, and compatibility results', async () => {
    const fixture = await extensionFixture()
    const expectedRoot = await realpath(fixture.packageRoot)
    const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
      ['unexpected Channel', (value) => { (value.plugin as Record<string, unknown>).channelIds = ['other'] }],
      ['duplicate Channel', (value) => { (value.plugin as Record<string, unknown>).channelIds = ['qq', 'qq'] }],
      ['non-string Channel', (value) => { (value.plugin as Record<string, unknown>).channelIds = [1] }],
      ['missing capabilities', (value) => { value.capabilities = null }],
      ['extra capability', (value) => { value.capabilities = [{ kind: 'channel', ids: ['qq'] }, { kind: 'tool', ids: [] }] }],
      ['wrong capability', (value) => { value.capabilities = [{ kind: 'tool', ids: ['qq'] }] }],
      ['missing diagnostics', (value) => { value.diagnostics = null }],
      ['invalid diagnostic', (value) => { value.diagnostics = [null] }],
      ['diagnostic error', (value) => { value.diagnostics = [{ level: 'error' }] }],
      ['missing compatibility', (value) => { value.compatibility = null }],
      ['compatibility error', (value) => { value.compatibility = [{ severity: 'error' }] }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(runtimeInspection(fixture.lock, fixture.packageRoot))
      mutate(value)
      await expect(verifyExtensionRuntimeInspection(JSON.stringify(value), fixture.lock, expectedRoot), label)
        .rejects.toThrow(/channel-openclaw/)
    }
  })

  it('rejects install-record and canonical-path disagreement', async () => {
    const fixture = await extensionFixture()
    const expectedRoot = await realpath(fixture.packageRoot)
    const install = clone(runtimeInspection(fixture.lock, fixture.packageRoot))
    ;(install.install as Record<string, unknown>).resolvedVersion = '0.0.0'
    await expect(verifyExtensionRuntimeInspection(JSON.stringify(install), fixture.lock, expectedRoot))
      .rejects.toThrow(/install record/)

    const emptyPath = clone(runtimeInspection(fixture.lock, fixture.packageRoot))
    ;(emptyPath.plugin as Record<string, unknown>).rootDir = ''
    await expect(verifyExtensionRuntimeInspection(JSON.stringify(emptyPath), fixture.lock, expectedRoot))
      .rejects.toThrow(/non-empty string/)

    const other = join(fixture.root, 'other')
    await mkdir(other)
    const mismatch = clone(runtimeInspection(fixture.lock, fixture.packageRoot))
    ;(mismatch.install as Record<string, unknown>).installPath = other
    await expect(verifyExtensionRuntimeInspection(JSON.stringify(mismatch), fixture.lock, expectedRoot))
      .rejects.toThrow(/paths disagree/)
  })
})
