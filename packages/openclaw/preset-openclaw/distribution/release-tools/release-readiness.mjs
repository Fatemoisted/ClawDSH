#!/usr/bin/env node
/** Fail closed before the workflow gains permission to write to public npm. */

import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyBootstrapAttestation } from './bootstrap-publication.mjs'
import { DSH_VERSION, RELEASE_VERSION } from './release-contract.mjs'

const REQUIRED_CONFIRMATIONS = Object.freeze([
  'scopeOwnershipConfirmed',
  'trustedPublishingConfirmed',
  'publicRepositoryApproved',
  'rc6CompatibilityConfirmed',
])

function yes(value) {
  return value === true || value === 'true'
}

/** Check manual authority, inert-bootstrap integrity, and clean-install smoke evidence. */
export function assertReleaseReadiness({
  publishRequested,
  githubRef,
  repositoryPrivate,
  confirmations,
  bootstrapIndex,
  bootstrapAttestation,
  releaseIndex,
  smokeAttestation,
}) {
  if (!yes(publishRequested)) return Object.freeze({ publish: false })
  if (githubRef !== 'refs/heads/clawdsh') {
    throw new TypeError('public npm publishing is restricted to refs/heads/clawdsh')
  }
  if (yes(repositoryPrivate)) throw new TypeError('public npm publishing is blocked while the repository is private')
  for (const name of REQUIRED_CONFIRMATIONS) {
    if (!yes(confirmations[name])) throw new TypeError(`public npm publishing requires ${name}`)
  }
  const bootstrap = verifyBootstrapAttestation(bootstrapIndex, bootstrapAttestation)
  const indexBytes = readFileSync(releaseIndex)
  const attestation = JSON.parse(readFileSync(smokeAttestation, 'utf8'))
  if (attestation.version !== 2
    || attestation.releaseVersion !== RELEASE_VERSION
    || attestation.dshVersion !== DSH_VERSION
    || attestation.cliStarted !== true
    || attestation.productPageVerified !== true
    || attestation.browserRuntimeVerified !== true) {
    throw new TypeError('clean-install smoke attestation does not prove the locked CLI/DSH product page')
  }
  const digest = `sha512-${createHash('sha512').update(indexBytes).digest('base64')}`
  if (attestation.releaseIndexIntegrity !== digest) {
    throw new TypeError('clean-install smoke attestation does not match release-index.json')
  }
  return Object.freeze({
    publish: true,
    releaseIndexIntegrity: digest,
    bootstrapIndexIntegrity: bootstrap.bootstrapIndexIntegrity,
  })
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = assertReleaseReadiness({
    publishRequested: process.env.CLAWDSH_PUBLISH_REQUESTED,
    githubRef: process.env.CLAWDSH_GITHUB_REF,
    repositoryPrivate: process.env.CLAWDSH_REPOSITORY_PRIVATE,
    confirmations: {
      scopeOwnershipConfirmed: process.env.CLAWDSH_SCOPE_OWNERSHIP_CONFIRMED,
      trustedPublishingConfirmed: process.env.CLAWDSH_TRUSTED_PUBLISHING_CONFIRMED,
      publicRepositoryApproved: process.env.CLAWDSH_PUBLIC_REPOSITORY_APPROVED,
      rc6CompatibilityConfirmed: process.env.CLAWDSH_RC6_COMPATIBILITY_CONFIRMED,
    },
    bootstrapIndex: process.env.CLAWDSH_BOOTSTRAP_INDEX,
    bootstrapAttestation: process.env.CLAWDSH_BOOTSTRAP_ATTESTATION,
    releaseIndex: process.env.CLAWDSH_RELEASE_INDEX,
    smokeAttestation: process.env.CLAWDSH_SMOKE_ATTESTATION,
  })
  process.stdout.write(result.publish ? 'public npm release readiness verified\n' : 'dry-run mode: public npm remains read-only\n')
}
