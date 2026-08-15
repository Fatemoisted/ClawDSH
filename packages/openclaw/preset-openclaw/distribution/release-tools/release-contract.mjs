/** Immutable package identity and publication order for the ClawDSH release. */

export const RELEASE_VERSION = '0.1.0-rc.1'
export const DSH_VERSION = '0.1.0-rc.6'
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const PUBLIC_TAG = 'next'

export const RELEASE_PACKAGES = Object.freeze([
  Object.freeze({ name: '@clawdsh/dsh-activity', directory: 'packages/openclaw/activity' }),
  Object.freeze({ name: '@clawdsh/dsh-channel', directory: 'packages/openclaw/channel' }),
  Object.freeze({ name: '@clawdsh/dsh-embeddings', directory: 'packages/openclaw/embeddings' }),
  Object.freeze({ name: '@clawdsh/dsh-automation', directory: 'packages/openclaw/automation' }),
  Object.freeze({ name: '@clawdsh/dsh-skills-hub', directory: 'packages/openclaw/skills-hub' }),
  Object.freeze({ name: '@clawdsh/dsh-soul', directory: 'packages/openclaw/soul' }),
  Object.freeze({ name: '@clawdsh/dsh-channel-agent', directory: 'packages/openclaw/channel-agent' }),
  Object.freeze({ name: '@clawdsh/dsh-channel-openclaw', directory: 'packages/openclaw/channel-openclaw' }),
  Object.freeze({ name: '@clawdsh/dsh-embeddings-ark', directory: 'packages/openclaw/embeddings-ark' }),
  Object.freeze({ name: '@clawdsh/dsh-memory', directory: 'packages/openclaw/memory' }),
  Object.freeze({
    name: '@clawdsh/dsh-preset-messaging-safe',
    directory: 'packages/openclaw/preset-clawdsh-messaging-safe',
  }),
  Object.freeze({
    name: '@clawdsh/dsh-bundle',
    directory: 'packages/openclaw/preset-openclaw/distribution/bundle',
    staged: true,
  }),
  Object.freeze({
    name: '@clawdsh/cli',
    directory: 'packages/openclaw/preset-openclaw/distribution/cli',
  }),
])

export const RELEASE_PACKAGE_NAMES = Object.freeze(RELEASE_PACKAGES.map(entry => entry.name))
const RELEASE_PACKAGE_NAME_SET = new Set(RELEASE_PACKAGE_NAMES)

export const LEGACY_PACKAGE_NAMES = Object.freeze([
  '@clawdsh/dsh-channel-core',
  '@clawdsh/dsh-channel-discord',
  '@clawdsh/dsh-channel-feishu',
  '@clawdsh/dsh-channel-telegram',
])

/** Return the deterministic tarball filename for one public package. */
export function tarballFilename(name, version = RELEASE_VERSION) {
  if (!RELEASE_PACKAGE_NAME_SET.has(name)) throw new TypeError(`unknown release package ${name}`)
  return `${name.slice(1).replace('/', '-')}-${version}.tgz`
}

/** Return whether a package belongs to the immutable public allowlist. */
export function isReleasePackage(name) {
  return RELEASE_PACKAGE_NAME_SET.has(name)
}

/** Parse and validate the comma-separated order copied into the workflow. */
export function parseReleaseOrder(value) {
  if (typeof value !== 'string') throw new TypeError('release order must be a string')
  const names = value.split(',').map(name => name.trim()).filter(Boolean)
  if (names.length !== RELEASE_PACKAGE_NAMES.length
    || names.some((name, index) => name !== RELEASE_PACKAGE_NAMES[index])) {
    throw new TypeError(`release order must equal ${RELEASE_PACKAGE_NAMES.join(',')}`)
  }
  return names
}
