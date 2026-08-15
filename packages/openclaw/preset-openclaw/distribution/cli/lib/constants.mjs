/** Immutable public-distribution identities used by the managed installer. */

export const CLI_VERSION = '0.1.0-rc.1'
export const BUNDLE_NAME = '@clawdsh/dsh-bundle'
export const BUNDLE_VERSION = '0.1.0-rc.1'
export const DSH_NAME = '@deepseek-ai/dsh'
export const DSH_VERSION = '0.1.0-rc.6'
export const PROFILE_ID = 'clawdsh'
export const PRIMARY_PRESET_ID = 'clawdsh'
export const SAFE_PRESET_ID = 'clawdsh-messaging-safe'
export const MARKER_FILENAME = '.clawdsh.json'
export const MARKER_SCHEMA_VERSION = 1
export const PROFILE_BUNDLES = Object.freeze([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  BUNDLE_NAME,
])
