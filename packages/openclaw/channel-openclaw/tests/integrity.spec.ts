import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hostTreeDigest,
  runtimeTreeDigest,
  sha512File,
  verifyFailClosedConfig,
  verifyManagedHost,
  verifyRuntimeInstallation,
} from '../src/integrity.ts'
import type { OpenClawExtensionLock } from '../src/extensions.ts'
import { installedProjectTreeDigest } from '../src/file-integrity.ts'
import { CANARY_OPENCLAW_LOCK, PRODUCTION_OPENCLAW_LOCK, type OpenClawRuntimeLock } from '../src/locks.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'channel-openclaw-integrity-'))
  roots.push(root)
  return root
}

function sha512(value: string): string {
  return createHash('sha512').update(value).digest('hex')
}

async function hostFixture(): Promise<{
  root: string
  artifactPath: string
  hostRoot: string
  lock: OpenClawRuntimeLock
}> {
  const root = await temporaryRoot()
  const artifactPath = join(root, 'openclaw.tgz')
  const hostRoot = join(root, 'host')
  await mkdir(join(hostRoot, 'nested'), { recursive: true })
  const packageText = `${JSON.stringify({ name: 'openclaw', version: '1.2.3', engines: { node: '>=24' } })}\n`
  await writeFile(artifactPath, 'artifact')
  await writeFile(join(hostRoot, 'package.json'), packageText)
  await writeFile(join(hostRoot, 'nested', 'runtime.js'), 'runtime')
  const tree = await hostTreeDigest(hostRoot)
  return {
    root,
    artifactPath,
    hostRoot,
    lock: {
      track: 'production',
      tag: 'v1.2.3',
      commitSha: 'a'.repeat(40),
      artifactSha512: sha512('artifact'),
      artifactKind: 'npm-tarball',
      artifactUrl: 'https://example.invalid/openclaw.tgz',
      packageVersion: '1.2.3',
      manifestVersion: '1.2.3',
      nodeEngine: '>=24',
      tree,
      agentHarness: 'v1',
    },
  }
}

interface RuntimeFixture {
  readonly root: string
  readonly runtimeRoot: string
  readonly hostRoot: string
  readonly checkedLock: ParsedRuntimeLock
  readonly hiddenLockPath: string
  readonly lock: OpenClawRuntimeLock
}

interface RuntimeLockEntry extends Record<string, unknown> {
  readonly version?: unknown
  readonly optional?: unknown
  readonly os?: unknown
  readonly cpu?: unknown
}

interface ParsedRuntimeLock {
  readonly name: string
  readonly lockfileVersion: number
  readonly packages: Record<string, RuntimeLockEntry>
}

interface AgentRouteFixture {
  id: string
  model: string | { primary: string; fallbacks: string[] }
  models?: Record<string, { agentRuntime: { id: string } }>
  agentRuntime?: { id: string }
  tools: { elevated: { enabled: boolean } }
}

interface FailClosedConfigFixture {
  models: {
    mode: string
    providers: Record<string, unknown> & {
      clawdsh: {
        agentRuntime: { id: string }
        models: Array<{ id: string; input: string[]; agentRuntime: { id: string } }>
      }
    }
  }
  agents: {
    defaults: {
      workspace: string
      model: { primary: string; fallbacks: string[] }
      models: Record<string, { agentRuntime: { id: string } }>
      elevatedDefault: string
    }
    list: AgentRouteFixture[]
  }
  plugins: {
    load: { paths: string[] }
    allow: Array<string | number>
    installs: Record<string, unknown>
    entries: Record<string, { enabled: boolean }>
  }
  gateway: { mode: string; bind: string }
  session: { dmScope: string }
  commands: Record<string, unknown>
  tools: { elevated: { enabled: boolean } }
  channels: Record<string, unknown>
}

function packageName(path: string): string {
  const tail = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const parts = tail.split('/')
  return parts[0]?.startsWith('@') === true ? parts.slice(0, 2).join('/') : parts[0] ?? 'missing'
}

async function runtimeFixture(): Promise<RuntimeFixture> {
  const root = await temporaryRoot()
  const runtimeRoot = join(root, 'runtime')
  const templateRoot = join(import.meta.dirname, '..', 'runtime')
  await mkdir(join(runtimeRoot, 'node_modules'), { recursive: true })
  const packageBytes = await readFile(join(templateRoot, 'package.json'))
  const lockBytes = await readFile(join(templateRoot, 'package-lock.json'))
  await writeFile(join(runtimeRoot, 'package.json'), packageBytes)
  await writeFile(join(runtimeRoot, 'package-lock.json'), lockBytes)
  const checkedLock = JSON.parse(lockBytes.toString('utf8')) as unknown as ParsedRuntimeLock
  const checkedPackages = checkedLock.packages
  const installedPackages: Record<string, unknown> = {}
  for (const [path, entry] of Object.entries(checkedPackages)) {
    if (path === '') continue
    const directory = join(runtimeRoot, ...path.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: packageName(path),
      version: entry.version,
    }))
    await writeFile(join(directory, 'index.js'), 'export const installed = true\n')
    installedPackages[path] = entry
  }
  const hiddenLockPath = join(runtimeRoot, 'node_modules', '.package-lock.json')
  await writeFile(hiddenLockPath, JSON.stringify({
    name: checkedLock.name,
    lockfileVersion: checkedLock.lockfileVersion,
    packages: installedPackages,
  }))
  const runtimeTree = await runtimeTreeDigest(runtimeRoot)
  return {
    root,
    runtimeRoot,
    hostRoot: join(runtimeRoot, 'node_modules', 'openclaw'),
    checkedLock,
    hiddenLockPath,
    lock: {
      ...PRODUCTION_OPENCLAW_LOCK,
      runtimeTrees: [{
        platform: process.platform,
        architecture: process.arch,
        ...runtimeTree,
      }],
    },
  }
}

function validConfig(bridgeRoot: string): FailClosedConfigFixture {
  return {
    models: {
      mode: 'replace',
      providers: {
        clawdsh: {
          agentRuntime: { id: 'clawdsh' },
          models: [{ id: 'local', input: ['text'], agentRuntime: { id: 'clawdsh' } }],
        },
      },
    },
    agents: {
      defaults: {
        workspace: join(bridgeRoot, '..', 'workspace'),
        model: { primary: 'clawdsh/local', fallbacks: [] },
        models: { 'clawdsh/local': { agentRuntime: { id: 'clawdsh' } } },
        elevatedDefault: 'off',
      },
      list: [
        { id: 'string-route', model: 'clawdsh/local', tools: { elevated: { enabled: false } } },
        {
          id: 'object-route',
          model: { primary: 'clawdsh/local', fallbacks: [] },
          models: { 'clawdsh/local': { agentRuntime: { id: 'clawdsh' } } },
          agentRuntime: { id: 'clawdsh' },
          tools: { elevated: { enabled: false } },
        },
      ],
    },
    plugins: {
      load: { paths: [bridgeRoot] },
      allow: ['clawdsh-bridge'],
      installs: {},
      entries: { 'clawdsh-bridge': { enabled: true } },
    },
    gateway: { mode: 'local', bind: 'loopback' },
    session: { dmScope: 'per-account-channel-peer' },
    commands: {
      bash: false,
      config: false,
      mcp: false,
      plugins: false,
      debug: false,
      restart: false,
      nativeSkills: false,
      text: true,
      useAccessGroups: true,
      allowFrom: { telegram: ['owner-1'] },
    },
    tools: { elevated: { enabled: false } },
    channels: {
      telegram: {
        enabled: true,
        configWrites: false,
        dmPolicy: 'pairing',
        groupPolicy: 'allowlist',
        groups: { '*': { requireMention: true } },
        allowFrom: ['owner-1'],
        accounts: {
          personal: {
            enabled: true,
            configWrites: false,
            dmPolicy: 'allowlist',
            groupPolicy: 'disabled',
          },
        },
      },
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function checkConfig(
  root: string,
  bridgeRoot: string,
  value: unknown,
  extensions: readonly OpenClawExtensionLock[] = [],
): Promise<void> {
  const path = join(root, `config-${Math.random().toString(16).slice(2)}.json`)
  await writeFile(path, JSON.stringify(value))
  await verifyFailClosedConfig(path, bridgeRoot, root, extensions)
}

describe('locked host integrity', () => {
  it('hashes files and deterministic ordinary-file trees', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, 'b'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'z.txt'), 'z')
    await writeFile(join(root, 'b', 'a.txt'), 'a')
    await writeFile(join(root, 'node_modules', 'ignored.js'), 'dependency')
    expect(await sha512File(join(root, 'z.txt'))).toBe(sha512('z'))
    expect(await hostTreeDigest(root)).toEqual(await hostTreeDigest(root))
    expect((await hostTreeDigest(root)).fileCount).toBe(2)
  })

  it('rejects symbolic links and non-file directory entries', async () => {
    const root = await temporaryRoot()
    await writeFile(join(root, 'target'), 'target')
    await symlink(join(root, 'target'), join(root, 'link'))
    await expect(hostTreeDigest(root)).rejects.toThrow(/symbolic link/)
    await rm(join(root, 'link'))

    if (process.platform !== 'win32') {
      const socketPath = join(root, 'socket')
      const server = createServer()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, resolve)
      })
      await expect(hostTreeDigest(root)).rejects.toThrow(/non-file entry/)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
  })

  it('locks an internal executable link to its exact ordinary-file target', async () => {
    if (process.platform === 'win32') return
    const root = await temporaryRoot()
    const packageRoot = join(root, 'node_modules', 'package')
    const binRoot = join(root, 'node_modules', '.bin')
    await mkdir(packageRoot, { recursive: true })
    await mkdir(binRoot)
    await writeFile(join(root, 'package.json'), '{}')
    await writeFile(join(packageRoot, 'first.js'), 'export const selected = 1\n')
    await writeFile(join(packageRoot, 'second.js'), 'export const selected = 2\n')
    const link = join(binRoot, 'package')
    await symlink('../package/first.js', link)
    const first = await runtimeTreeDigest(root)
    await rm(link)
    await symlink('../package/second.js', link)
    expect(await runtimeTreeDigest(root)).not.toEqual(first)
  })

  it('rejects invalid installed-project roots, exclusions, link targets, and entries', async () => {
    await expect(installedProjectTreeDigest('relative')).rejects.toThrow(/must be absolute/)

    const fileRoot = await temporaryRoot()
    const file = join(fileRoot, 'file')
    await writeFile(file, 'not a project')
    await expect(installedProjectTreeDigest(file)).rejects.toThrow(/ordinary directory/)

    const excluded = await temporaryRoot()
    await expect(installedProjectTreeDigest(excluded, ['relative']))
      .rejects.toThrow(/absolute path inside/)
    await expect(installedProjectTreeDigest(excluded, [join(excluded, '..', 'outside')]))
      .rejects.toThrow(/absolute path inside/)

    const linkedDirectory = await temporaryRoot()
    await mkdir(join(linkedDirectory, 'target'))
    await symlink('target', join(linkedDirectory, 'link'))
    await expect(installedProjectTreeDigest(linkedDirectory))
      .rejects.toThrow(/does not target an ordinary file/)

    if (process.platform !== 'win32') {
      const special = await temporaryRoot()
      const socketPath = join(special, 'socket')
      const server = createServer()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, resolve)
      })
      await expect(installedProjectTreeDigest(special)).rejects.toThrow(/non-file entry/)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }
  })

  it('verifies a complete locked artifact and extracted tree', async () => {
    const fixture = await hostFixture()
    await expect(verifyManagedHost(fixture.lock, fixture.artifactPath, fixture.hostRoot)).resolves.toBeUndefined()
  })

  it('fails closed for incomplete locks, relative paths, and every identity mismatch', async () => {
    const fixture = await hostFixture()
    const { tree, ...incompleteLock } = fixture.lock
    expect(tree).toBeDefined()
    await expect(verifyManagedHost(incompleteLock, fixture.artifactPath, fixture.hostRoot))
      .rejects.toThrow(/no locked runnable tree/)
    await expect(verifyManagedHost(fixture.lock, 'relative.tgz', fixture.hostRoot)).rejects.toThrow(/must be absolute/)
    await expect(verifyManagedHost(fixture.lock, fixture.artifactPath, 'relative-host')).rejects.toThrow(/must be absolute/)
    await expect(verifyManagedHost({ ...fixture.lock, artifactSha512: '0'.repeat(128) }, fixture.artifactPath, fixture.hostRoot))
      .rejects.toThrow(/artifact SHA-512/)

    await writeFile(join(fixture.hostRoot, 'package.json'), JSON.stringify({ name: 'other', version: '1.2.3', engines: { node: '>=24' } }))
    await expect(verifyManagedHost(fixture.lock, fixture.artifactPath, fixture.hostRoot)).rejects.toThrow(/name\/version/)
    await writeFile(join(fixture.hostRoot, 'package.json'), JSON.stringify({ name: 'openclaw', version: '1.2.3', engines: { node: 'wrong' } }))
    await expect(verifyManagedHost(fixture.lock, fixture.artifactPath, fixture.hostRoot)).rejects.toThrow(/Node engine/)
    await writeFile(join(fixture.hostRoot, 'package.json'), JSON.stringify({ name: 'openclaw', version: '1.2.3', engines: { node: '>=24' } }))
    await expect(verifyManagedHost(fixture.lock, fixture.artifactPath, fixture.hostRoot)).rejects.toThrow(/extracted host tree/)
  })
})

describe('checked runtime dependency installation', () => {
  it('verifies every installed package against the checked npm v3 lock', async () => {
    const fixture = await runtimeFixture()
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, fixture.hostRoot))
      .resolves.toBeUndefined()
  })

  it('rejects changed dependency bytes and platforms without one exact aggregate lock', async () => {
    const changed = await runtimeFixture()
    const dependencyPath = Object.keys(changed.checkedLock.packages)
      .find(path => path !== '' && path !== 'node_modules/openclaw') as string
    await writeFile(join(changed.runtimeRoot, ...dependencyPath.split('/'), 'index.js'), 'export const installed = false\n')
    await expect(verifyRuntimeInstallation(changed.lock, changed.runtimeRoot, changed.hostRoot))
      .rejects.toThrow(/runtime ordinary-file tree differs/)

    const unsupported = await runtimeFixture()
    const missingRuntimeTrees: OpenClawRuntimeLock = { ...unsupported.lock }
    Reflect.deleteProperty(missingRuntimeTrees, 'runtimeTrees')
    await expect(verifyRuntimeInstallation(
      missingRuntimeTrees,
      unsupported.runtimeRoot,
      unsupported.hostRoot,
    )).rejects.toThrow(/no unique locked runtime tree/)
    await expect(verifyRuntimeInstallation(
      { ...unsupported.lock, runtimeTrees: [] },
      unsupported.runtimeRoot,
      unsupported.hostRoot,
    )).rejects.toThrow(/no unique locked runtime tree/)

    const invalid = await runtimeFixture()
    const invalidRuntimeTree = invalid.lock.runtimeTrees?.[0]
    if (invalidRuntimeTree === undefined) throw new Error('runtime fixture has no tree lock')
    await expect(verifyRuntimeInstallation(
      { ...invalid.lock, runtimeTrees: [{ ...invalidRuntimeTree, fileCount: 0 }] },
      invalid.runtimeRoot,
      invalid.hostRoot,
    )).rejects.toThrow(/locked runtime tree .* is invalid/)

    const duplicate = await runtimeFixture()
    const runtimeTree = duplicate.lock.runtimeTrees?.[0]
    if (runtimeTree === undefined) throw new Error('runtime fixture has no tree lock')
    await expect(verifyRuntimeInstallation(
      { ...duplicate.lock, runtimeTrees: [runtimeTree, runtimeTree] },
      duplicate.runtimeRoot,
      duplicate.hostRoot,
    )).rejects.toThrow(/no unique locked runtime tree/)
  })

  it('rejects a runtime file symlink that escapes the locked project', async () => {
    const fixture = await runtimeFixture()
    const outside = join(fixture.root, 'outside.js')
    await writeFile(outside, 'export const injected = true\n')
    const bin = join(fixture.runtimeRoot, 'node_modules', '.bin')
    await mkdir(bin)
    await symlink(outside, join(bin, 'injected'))
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, fixture.hostRoot))
      .rejects.toThrow(/link escapes its root/)
  })

  it('rejects tracks without a runtime lock, relative paths, non-directories, and host relocation', async () => {
    const fixture = await runtimeFixture()
    await expect(verifyRuntimeInstallation(CANARY_OPENCLAW_LOCK, fixture.runtimeRoot, fixture.hostRoot))
      .rejects.toThrow(/no locked runtime dependency assembly/)
    await expect(verifyRuntimeInstallation(fixture.lock, 'relative', fixture.hostRoot))
      .rejects.toThrow(/must be absolute/)
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, 'relative'))
      .rejects.toThrow(/must be absolute/)
    await expect(verifyRuntimeInstallation(fixture.lock, join(fixture.root, 'missing'), fixture.hostRoot))
      .rejects.toThrow()
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, join(fixture.runtimeRoot, 'node_modules')))
      .rejects.toThrow(/hostRoot must be/)

    const symlinkedRoot = join(fixture.root, 'runtime-link')
    await symlink(fixture.runtimeRoot, symlinkedRoot)
    await expect(verifyRuntimeInstallation(fixture.lock, symlinkedRoot, fixture.hostRoot))
      .rejects.toThrow(/ordinary directory/)
  })

  it('rejects deployed assembly-input changes and an internally inconsistent packaged lock', async () => {
    const packageFixture = await runtimeFixture()
    await writeFile(join(packageFixture.runtimeRoot, 'package.json'), '{}')
    await expect(verifyRuntimeInstallation(packageFixture.lock, packageFixture.runtimeRoot, packageFixture.hostRoot))
      .rejects.toThrow(/package.json differs/)

    const lockFixture = await runtimeFixture()
    await writeFile(join(lockFixture.runtimeRoot, 'package-lock.json'), '{}')
    await expect(verifyRuntimeInstallation(lockFixture.lock, lockFixture.runtimeRoot, lockFixture.hostRoot))
      .rejects.toThrow(/deployed runtime dependency lock differs/)

    const digestFixture = await runtimeFixture()
    await expect(verifyRuntimeInstallation(
      { ...digestFixture.lock, runtimePackageLockSha512: '0'.repeat(128) },
      digestFixture.runtimeRoot,
      digestFixture.hostRoot,
    )).rejects.toThrow(/packaged runtime dependency lock/)
  })

  it('rejects malformed and identity-changing installed locks', async () => {
    const malformed = await runtimeFixture()
    await writeFile(malformed.hiddenLockPath, '{')
    await expect(verifyRuntimeInstallation(malformed.lock, malformed.runtimeRoot, malformed.hostRoot))
      .rejects.toThrow(/not strict JSON/)

    const wrongFormat = await runtimeFixture()
    await writeFile(wrongFormat.hiddenLockPath, JSON.stringify({ name: 'other', lockfileVersion: 2, packages: {} }))
    await expect(verifyRuntimeInstallation(wrongFormat.lock, wrongFormat.runtimeRoot, wrongFormat.hostRoot))
      .rejects.toThrow(/unexpected identity or format/)

    const missingPackages = await runtimeFixture()
    await writeFile(missingPackages.hiddenLockPath, JSON.stringify({
      name: 'clawdsh-openclaw-runtime', lockfileVersion: 3, packages: [],
    }))
    await expect(verifyRuntimeInstallation(missingPackages.lock, missingPackages.runtimeRoot, missingPackages.hostRoot))
      .rejects.toThrow(/packages must be an object/)
  })

  it('rejects invalid paths, identity drift, absent directories, and package metadata drift', async () => {
    const fixture = await runtimeFixture()
    const packages = clone(fixture.checkedLock.packages)
    delete packages['']
    packages.invalid = { version: '1.0.0' }
    await writeFile(fixture.hiddenLockPath, JSON.stringify({ name: fixture.checkedLock.name, lockfileVersion: 3, packages }))
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, fixture.hostRoot))
      .rejects.toThrow(/invalid package path/)

    const identity = await runtimeFixture()
    const identityPackages = clone(identity.checkedLock.packages)
    delete identityPackages['']
    ;(identityPackages['node_modules/openclaw'] as Record<string, unknown>).version = '0.0.0'
    await writeFile(identity.hiddenLockPath, JSON.stringify({
      name: identity.checkedLock.name,
      lockfileVersion: 3,
      packages: identityPackages,
    }))
    await expect(verifyRuntimeInstallation(identity.lock, identity.runtimeRoot, identity.hostRoot))
      .rejects.toThrow(/differs from the checked dependency lock/)

    const absent = await runtimeFixture()
    const absentPackages = clone(absent.checkedLock.packages)
    delete absentPackages['']
    const absentPath = Object.keys(absentPackages).find(path => path !== 'node_modules/openclaw') as string
    await rm(join(absent.runtimeRoot, ...absentPath.split('/')), { recursive: true })
    await writeFile(absent.hiddenLockPath, JSON.stringify({ name: absent.checkedLock.name, lockfileVersion: 3, packages: absentPackages }))
    await expect(verifyRuntimeInstallation(absent.lock, absent.runtimeRoot, absent.hostRoot))
      .rejects.toThrow(/absent or not an ordinary directory/)

    const metadata = await runtimeFixture()
    await writeFile(join(metadata.hostRoot, 'package.json'), JSON.stringify({ name: 'openclaw', version: 'wrong' }))
    await expect(verifyRuntimeInstallation(metadata.lock, metadata.runtimeRoot, metadata.hostRoot))
      .rejects.toThrow(/metadata differs/)
  })

  it.each([
    'node_modules/a//b',
    'node_modules/a/../b',
    'node_modules/a/b',
    'node_modules/@scope',
    'node_modules/a/node_modules',
  ])('rejects non-canonical installed-lock key %s', async (invalidPath) => {
    const fixture = await runtimeFixture()
    const packages = clone(fixture.checkedLock.packages)
    delete packages['']
    packages[invalidPath] = { version: '1.0.0' }
    await writeFile(fixture.hiddenLockPath, JSON.stringify({ name: fixture.checkedLock.name, lockfileVersion: 3, packages }))
    await expect(verifyRuntimeInstallation(fixture.lock, fixture.runtimeRoot, fixture.hostRoot))
      .rejects.toThrow(/invalid package path/)
  })

  it('rejects untracked package directories and required packages omitted from the installed lock', async () => {
    const untracked = await runtimeFixture()
    await mkdir(join(untracked.runtimeRoot, 'node_modules', 'untracked'))
    await writeFile(join(untracked.runtimeRoot, 'node_modules', 'untracked', 'package.json'), JSON.stringify({
      name: 'untracked', version: '1.0.0',
    }))
    await expect(verifyRuntimeInstallation(untracked.lock, untracked.runtimeRoot, untracked.hostRoot))
      .rejects.toThrow(/untracked package directory/)

    const missing = await runtimeFixture()
    const packages = clone(missing.checkedLock.packages)
    delete packages['']
    const required = Object.entries(packages).find(([, entry]) => {
      const candidate = entry as Record<string, unknown>
      return candidate.optional !== true && candidate.os === undefined && candidate.cpu === undefined
        && candidate !== packages['node_modules/openclaw']
    })?.[0] as string
    Reflect.deleteProperty(packages, required)
    await rm(join(missing.runtimeRoot, ...required.split('/')), { recursive: true })
    await writeFile(missing.hiddenLockPath, JSON.stringify({ name: missing.checkedLock.name, lockfileVersion: 3, packages }))
    await expect(verifyRuntimeInstallation(missing.lock, missing.runtimeRoot, missing.hostRoot))
      .rejects.toThrow(/required runtime package .* is missing/)
  })

  it('rejects node_modules and scoped-package indirections', async () => {
    const packageLink = await runtimeFixture()
    const victim = Object.keys(packageLink.checkedLock.packages)
      .find(path => /\/node_modules\/[^@/]+$/.test(path)) as string
    await rm(join(packageLink.runtimeRoot, ...victim.split('/')), { recursive: true })
    await symlink(packageLink.hostRoot, join(packageLink.runtimeRoot, ...victim.split('/')))
    await expect(verifyRuntimeInstallation(packageLink.lock, packageLink.runtimeRoot, packageLink.hostRoot))
      .rejects.toThrow(/non-directory entry/)

    const scoped = await runtimeFixture()
    const scopePath = Object.keys(scoped.checkedLock.packages)
      .find(path => path.includes('/node_modules/@')) as string
    const scopeParts = scopePath.split('/')
    const scopeIndex = scopeParts.lastIndexOf('node_modules')
    const scopeRoot = scopeParts.slice(0, scopeIndex + 2).join('/')
    await rm(join(scoped.runtimeRoot, ...scopeRoot.split('/')), { recursive: true })
    await mkdir(join(scoped.runtimeRoot, ...scopeRoot.split('/')))
    await writeFile(join(scoped.runtimeRoot, ...scopeRoot.split('/'), 'bad'), 'not a directory')
    await expect(verifyRuntimeInstallation(scoped.lock, scoped.runtimeRoot, scoped.hostRoot))
      .rejects.toThrow(/scope contains a non-directory entry/)
  })
})

describe('fail-closed OpenClaw config', () => {
  it('accepts only the ClawDSH provider, model, bridge, and loopback Gateway', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    await expect(checkConfig(root, bridgeRoot, validConfig(bridgeRoot))).resolves.toBeUndefined()

    const minimal = validConfig(bridgeRoot)
    Reflect.deleteProperty(minimal.commands, 'allowFrom')
    await expect(checkConfig(root, bridgeRoot, minimal)).resolves.toBeUndefined()

    const sparse = validConfig(bridgeRoot)
    Reflect.deleteProperty(sparse.plugins, 'installs')
    Reflect.deleteProperty(sparse.agents, 'list')
    sparse.channels = {}
    await expect(checkConfig(root, bridgeRoot, sparse)).resolves.toBeUndefined()
  })

  it('requires the exact enabled plugin set for explicitly locked extensions', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    const extension: OpenClawExtensionLock = {
      pluginId: 'qqbot',
      channelIds: ['qq'],
      packageName: '@openclaw/qqbot',
      version: '1.2.3',
      integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
      projectTree: { fileCount: 2, sha512: '0'.repeat(128) },
    }
    const value = validConfig(bridgeRoot)
    value.plugins.allow = ['qqbot', 'clawdsh-bridge']
    value.plugins.entries = { qqbot: { enabled: true }, 'clawdsh-bridge': { enabled: true } }
    await expect(checkConfig(root, bridgeRoot, value, [extension])).resolves.toBeUndefined()

    const cases: Array<[string, (candidate: FailClosedConfigFixture) => void]> = [
      ['missing allow entry', (candidate) => { candidate.plugins.allow = ['clawdsh-bridge'] }],
      ['extra allow entry', (candidate) => { candidate.plugins.allow.push('other') }],
      ['missing config entry', (candidate) => { Reflect.deleteProperty(candidate.plugins.entries, 'qqbot') }],
      ['extra config entry', (candidate) => { candidate.plugins.entries.other = { enabled: true } }],
      ['disabled extension', (candidate) => { candidate.plugins.entries.qqbot!.enabled = false }],
    ]
    for (const [label, mutate] of cases) {
      const candidate = clone(value)
      mutate(candidate)
      await expect(checkConfig(root, bridgeRoot, candidate, [extension]), label).rejects.toThrow(/channel-openclaw/)
    }

    await expect(checkConfig(root, bridgeRoot, value, [{ ...extension, version: 'latest' }]))
      .rejects.toThrow(/exact semantic version/)
  })

  it('rejects non-absolute inputs, malformed JSON, and non-object documents', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    const malformed = join(root, 'malformed.json')
    await writeFile(malformed, '{')
    await expect(verifyFailClosedConfig('relative.json', bridgeRoot)).rejects.toThrow(/must be absolute/)
    await expect(verifyFailClosedConfig(malformed, 'relative-bridge')).rejects.toThrow(/must be absolute/)
    await expect(verifyFailClosedConfig(malformed, bridgeRoot)).rejects.toThrow(/strict JSON/)
    const scalar = join(root, 'scalar.json')
    await writeFile(scalar, 'null')
    await expect(verifyFailClosedConfig(scalar, bridgeRoot)).rejects.toThrow(/must be an object/)
  })

  it('rejects config symlinks and config files outside the declared state directory', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    const stateDir = join(root, 'state')
    const outside = join(root, 'outside.json')
    await mkdir(bridgeRoot)
    await mkdir(stateDir)
    await writeFile(outside, JSON.stringify(validConfig(bridgeRoot)))
    const linked = join(stateDir, 'openclaw.json')
    await symlink(outside, linked)
    await expect(verifyFailClosedConfig(linked, bridgeRoot, stateDir)).rejects.toThrow(/non-symlink file/)
    await expect(verifyFailClosedConfig(outside, bridgeRoot, stateDir)).rejects.toThrow(/inside stateDir/)
  })

  it('rejects model provider and default-route escape hatches', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    const cases: Array<[string, (value: FailClosedConfigFixture) => void]> = [
      ['models', (value) => { Reflect.set(value, 'models', []) }],
      ['models.mode', (value) => { value.models.mode = 'merge' }],
      ['only provider', (value) => { value.models.providers.other = {} }],
      ['provider runtime', (value) => { value.models.providers.clawdsh.agentRuntime.id = 'other' }],
      ['sole provider model', (value) => { value.models.providers.clawdsh.models = [] }],
      ['provider model input', (value) => { value.models.providers.clawdsh.models[0]!.input = ['text', 'image'] }],
      ['default model', (value) => { value.agents.defaults.model.primary = 'other/model' }],
      ['isolated workspace', (value) => { value.agents.defaults.workspace = '/tmp/other-workspace' }],
      ['empty fallback', (value) => { value.agents.defaults.model.fallbacks = ['other/model'] }],
      ['model allowlist', (value) => { value.agents.defaults.models.other = { agentRuntime: { id: 'other' } } }],
      ['AgentHarness', (value) => { value.agents.defaults.models['clawdsh/local']!.agentRuntime.id = 'other' }],
      ['agents.list array', (value) => { Reflect.set(value.agents, 'list', {}) }],
      ['agent object', (value) => { Reflect.set(value.agents.list, 0, 'bad') }],
      ['agent string model', (value) => { value.agents.list[0]!.model = 'other/model' }],
      ['agent model object', (value) => {
        const model = value.agents.list[1]!.model as { primary: string; fallbacks: string[] }
        model.fallbacks = ['other/model']
      }],
      ['agent model allowlist', (value) => { value.agents.list[1]!.models!.other = { agentRuntime: { id: 'other' } } }],
      ['agent model runtime', (value) => {
        value.agents.list[1]!.models!['clawdsh/local']!.agentRuntime.id = 'other'
      }],
      ['agent runtime', (value) => { value.agents.list[1]!.agentRuntime!.id = 'other' }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(validConfig(bridgeRoot))
      mutate(value)
      await expect(checkConfig(root, bridgeRoot, value), label).rejects.toThrow(/channel-openclaw/)
    }
  })

  it('rejects plugin loading, install, enablement, and Gateway escapes', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    const otherRoot = join(root, 'other')
    await mkdir(bridgeRoot)
    await mkdir(otherRoot)
    const cases: Array<[string, (value: FailClosedConfigFixture) => void]> = [
      ['load record', (value) => { Reflect.set(value.plugins, 'load', []) }],
      ['load paths array', (value) => { Reflect.set(value.plugins.load, 'paths', {}) }],
      ['absolute load path', (value) => { value.plugins.load.paths = ['relative'] }],
      ['sole load path', (value) => { value.plugins.load.paths.push(otherRoot) }],
      ['allow array', (value) => { Reflect.set(value.plugins, 'allow', {}) }],
      ['allow strings', (value) => { value.plugins.allow = [1, 'clawdsh-bridge'] }],
      ['allow duplicates', (value) => { value.plugins.allow.push('clawdsh-bridge') }],
      ['allow bridge', (value) => { value.plugins.allow = [] }],
      ['installs object', (value) => { Reflect.set(value.plugins, 'installs', []) }],
      ['locked installs', (value) => { value.plugins.installs = { external: {} } }],
      ['entries object', (value) => { Reflect.set(value.plugins, 'entries', []) }],
      ['bridge entry object', (value) => { Reflect.set(value.plugins.entries, 'clawdsh-bridge', false) }],
      ['bridge enabled', (value) => { value.plugins.entries['clawdsh-bridge']!.enabled = false }],
      ['Gateway mode', (value) => { value.gateway.mode = 'remote' }],
      ['Gateway bind', (value) => { value.gateway.bind = 'lan' }],
      ['missing Session policy', (value) => { Reflect.deleteProperty(value, 'session') }],
      ['unsafe DM scope', (value) => { value.session.dmScope = 'main' }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(validConfig(bridgeRoot))
      mutate(value)
      await expect(checkConfig(root, bridgeRoot, value), label).rejects.toThrow(/channel-openclaw/)
    }
  })

  it('disables management commands and elevated tools while retaining admitted text commands', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    const cases: Array<[string, (value: FailClosedConfigFixture) => void]> = [
      ['commands object', (value) => { Reflect.set(value, 'commands', []) }],
      ['bash command', (value) => { value.commands.bash = true }],
      ['config command', (value) => { value.commands.config = undefined }],
      ['mcp command', (value) => { value.commands.mcp = true }],
      ['plugins command', (value) => { value.commands.plugins = true }],
      ['debug command', (value) => { value.commands.debug = true }],
      ['restart command', (value) => { value.commands.restart = true }],
      ['native skill command', (value) => { value.commands.nativeSkills = true }],
      ['text commands disabled', (value) => { value.commands.text = false }],
      ['command access groups disabled', (value) => { value.commands.useAccessGroups = false }],
      ['flat command wildcard', (value) => { value.commands.allowFrom = ['*'] }],
      ['nested command wildcard', (value) => { value.commands.allowFrom = { telegram: { owner: ['*'] } } }],
      ['malformed command allowlist', (value) => { value.commands.allowFrom = 'owner-1' }],
      ['missing global tools', (value) => { Reflect.deleteProperty(value, 'tools') }],
      ['global elevated tools', (value) => { value.tools.elevated.enabled = true }],
      ['malformed elevated tools', (value) => { Reflect.set(value.tools, 'elevated', true) }],
      ['missing default elevated policy', (value) => {
        Reflect.deleteProperty(value.agents.defaults, 'elevatedDefault')
      }],
      ['default elevated policy', (value) => { value.agents.defaults.elevatedDefault = 'on' }],
      ['missing per-Agent tools', (value) => { Reflect.deleteProperty(value.agents.list[0]!, 'tools') }],
      ['per-Agent elevated tools', (value) => {
        value.agents.list[0]!.tools = { elevated: { enabled: true } }
      }],
      ['malformed per-Agent elevated tools', (value) => {
        Reflect.set(value.agents.list[0]!, 'tools', { elevated: true })
      }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(validConfig(bridgeRoot))
      mutate(value)
      await expect(checkConfig(root, bridgeRoot, value), label).rejects.toThrow(/channel-openclaw/)
    }
  })

  it('rejects Channel settings that weaken pairing, allowlists, mentions, or config immutability', async () => {
    const root = await temporaryRoot()
    const bridgeRoot = join(root, 'bridge')
    await mkdir(bridgeRoot)
    const telegram = (value: FailClosedConfigFixture): Record<string, unknown> =>
      value.channels.telegram as Record<string, unknown>
    const account = (value: FailClosedConfigFixture): Record<string, unknown> =>
      (telegram(value).accounts as Record<string, Record<string, unknown>>).personal!
    const extensions: OpenClawExtensionLock[] = [{
      pluginId: 'feishu',
      channelIds: ['feishu'],
      packageName: '@openclaw/feishu',
      version: '1.2.3',
      integrity: `sha512-${Buffer.alloc(64, 8).toString('base64')}`,
      projectTree: { fileCount: 2, sha512: '1'.repeat(128) },
    }, {
      pluginId: 'discord',
      channelIds: ['discord'],
      packageName: '@openclaw/discord',
      version: '1.2.3',
      integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
      projectTree: { fileCount: 2, sha512: '2'.repeat(128) },
    }]
    const supported = clone(validConfig(bridgeRoot))
    supported.plugins.allow = ['clawdsh-bridge', 'feishu', 'discord']
    supported.plugins.entries = {
      'clawdsh-bridge': { enabled: true },
      feishu: { enabled: true },
      discord: { enabled: true },
    }
    supported.channels.feishu = {
      enabled: true,
      configWrites: false,
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      requireMention: true,
    }
    supported.channels.discord = {
      enabled: true,
      configWrites: false,
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      guilds: { '*': { requireMention: true } },
    }
    supported.channels.matrix = { enabled: false }
    await expect(checkConfig(root, bridgeRoot, supported, extensions)).resolves.toBeUndefined()
    const unsafeDiscord = clone(supported)
    const guilds = (unsafeDiscord.channels.discord as Record<string, unknown>).guilds as Record<string, Record<string, unknown>>
    Reflect.deleteProperty(guilds['*']!, 'requireMention')
    await expect(checkConfig(root, bridgeRoot, unsafeDiscord, extensions)).rejects.toThrow(/requireMention/)
    const cases: Array<[string, (value: FailClosedConfigFixture) => void]> = [
      ['missing channels object', (value) => { Reflect.deleteProperty(value, 'channels') }],
      ['channels object', (value) => { Reflect.set(value, 'channels', []) }],
      ['Channel object', (value) => { value.channels.telegram = [] }],
      ['missing Channel enabled', (value) => { Reflect.deleteProperty(telegram(value), 'enabled') }],
      ['unsupported enabled Channel', (value) => { value.channels.matrix = { enabled: true } }],
      ['unlocked Feishu Channel', (value) => { value.channels.feishu = { enabled: true } }],
      ['unlocked Discord Channel', (value) => { value.channels.discord = { enabled: true } }],
      ['missing Channel configWrites', (value) => { Reflect.deleteProperty(telegram(value), 'configWrites') }],
      ['Channel configWrites', (value) => { telegram(value).configWrites = true }],
      ['missing Channel DM policy', (value) => { Reflect.deleteProperty(telegram(value), 'dmPolicy') }],
      ['missing Channel group policy', (value) => { Reflect.deleteProperty(telegram(value), 'groupPolicy') }],
      ['missing Channel mention defaults', (value) => { Reflect.deleteProperty(telegram(value), 'groups') }],
      ['missing Channel wildcard mention policy', (value) => {
        const groups = telegram(value).groups as Record<string, unknown>
        Reflect.deleteProperty(groups, '*')
      }],
      ['accounts record', (value) => { telegram(value).accounts = [] }],
      ['account object', (value) => {
        const accounts = telegram(value).accounts as Record<string, unknown>
        accounts.personal = []
      }],
      ['missing account enabled', (value) => { Reflect.deleteProperty(account(value), 'enabled') }],
      ['missing account configWrites', (value) => { Reflect.deleteProperty(account(value), 'configWrites') }],
      ['account configWrites', (value) => { account(value).configWrites = true }],
      ['missing account DM policy', (value) => { Reflect.deleteProperty(account(value), 'dmPolicy') }],
      ['missing account group policy', (value) => { Reflect.deleteProperty(account(value), 'groupPolicy') }],
      ['open DM policy', (value) => { telegram(value).dmPolicy = 'open' }],
      ['open group policy', (value) => { telegram(value).groupPolicy = 'open' }],
      ['disabled mention requirement', (value) => {
        const groups = telegram(value).groups as Record<string, Record<string, unknown>>
        groups['*']!.requireMention = false
      }],
      ['public sender wildcard', (value) => { telegram(value).allowFrom = ['*'] }],
      ['public group wildcard', (value) => { telegram(value).groupAllowFrom = ['*'] }],
      ['public user wildcard', (value) => { telegram(value).allowedUserIds = ['*'] }],
      ['Channel access groups disabled', (value) => { account(value).useAccessGroups = false }],
      ['nested open DM policy', (value) => { telegram(value).nested = { dmPolicy: 'open' } }],
      ['nested open group policy', (value) => { telegram(value).nested = { groupPolicy: 'open' } }],
      ['nested disabled mention requirement', (value) => { telegram(value).nested = { requireMention: false } }],
      ['nested config writes', (value) => { telegram(value).nested = { configWrites: true } }],
      ['disabled Channel unsafe nested setting', (value) => {
        value.channels.matrix = { enabled: false, nested: { configWrites: true } }
      }],
    ]
    for (const [label, mutate] of cases) {
      const value = clone(validConfig(bridgeRoot))
      mutate(value)
      await expect(checkConfig(root, bridgeRoot, value), label).rejects.toThrow(/channel-openclaw/)
    }
  })
})
