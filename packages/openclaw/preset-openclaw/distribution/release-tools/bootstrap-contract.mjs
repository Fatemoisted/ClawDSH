/** Immutable content contract for the one-time inert npm bootstrap. */

import {
  BOOTSTRAP_TAG,
  BOOTSTRAP_VERSION,
  PUBLIC_NPM_REGISTRY,
  RELEASE_PACKAGES,
  RELEASE_VERSION,
  tarballFilename,
} from './release-contract.mjs'

export const BOOTSTRAP_INDEX_FILENAME = 'bootstrap-index.json'
export const PROJECT_REPOSITORY = 'git+https://github.com/Fatemoisted/ClawDSH.git'
export const PROJECT_HOMEPAGE = 'https://github.com/Fatemoisted/ClawDSH#readme'
export const PROJECT_BUGS = 'https://github.com/Fatemoisted/ClawDSH/issues'

/** Return the exact inert package manifest for one allowlisted name. */
export function bootstrapManifest(specification) {
  return Object.freeze({
    name: specification.name,
    version: BOOTSTRAP_VERSION,
    description: `Inert ClawDSH bootstrap for ${specification.name}; install ${RELEASE_VERSION} or later instead`,
    license: 'MIT',
    repository: Object.freeze({
      type: 'git',
      url: PROJECT_REPOSITORY,
      directory: specification.directory,
    }),
    homepage: PROJECT_HOMEPAGE,
    bugs: Object.freeze({ url: PROJECT_BUGS }),
    publishConfig: Object.freeze({
      access: 'public',
      registry: PUBLIC_NPM_REGISTRY,
      tag: BOOTSTRAP_TAG,
    }),
  })
}

/** Return the exact warning README for one inert package. */
export function bootstrapReadme(name) {
  return `# ${name}\n\nThis is an inert one-time bootstrap package used only to create the public npm package identity before trusted publishing is configured. It contains no executable code, exports, scripts, or dependencies. Do not install this version.\n\nThe first functional ClawDSH candidate is \`${RELEASE_VERSION}\`. It is released only under the \`next\` dist-tag by the provenance-bearing OIDC workflow after all release gates pass. The bootstrap version remains under the \`${BOOTSTRAP_TAG}\` dist-tag and must never create \`latest\`.\n\nProject: ${PROJECT_HOMEPAGE}\n`
}

/** Return the exact filename for one bootstrap archive. */
export function bootstrapTarballFilename(name) {
  return tarballFilename(name, BOOTSTRAP_VERSION)
}

/** Return the closed bootstrap package set in canonical release order. */
export function bootstrapSpecifications() {
  return RELEASE_PACKAGES
}

/** Return canonical newline-terminated JSON. */
export function canonicalBootstrapJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}
