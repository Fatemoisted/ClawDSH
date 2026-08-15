import { describe, expect, it } from 'vitest'
import { supportsCurrentPlatform } from '../src/npm-platform.ts'

describe('npm platform selectors', () => {
  it('accepts absent selectors and matching positive selectors', () => {
    expect(supportsCurrentPlatform({}, 'darwin', 'arm64')).toBe(true)
    expect(supportsCurrentPlatform({ os: ['darwin'], cpu: ['arm64'] }, 'darwin', 'arm64')).toBe(true)
  })

  it('applies negative selectors before positive selectors', () => {
    expect(supportsCurrentPlatform({ os: ['!darwin'] }, 'darwin', 'arm64')).toBe(false)
    expect(supportsCurrentPlatform({ os: ['!linux'] }, 'darwin', 'arm64')).toBe(true)
    expect(supportsCurrentPlatform({ os: ['linux'] }, 'darwin', 'arm64')).toBe(false)
    expect(supportsCurrentPlatform({ cpu: ['!arm64'] }, 'darwin', 'arm64')).toBe(false)
  })

  it('rejects malformed selector fields', () => {
    expect(supportsCurrentPlatform({ os: 'darwin' }, 'darwin', 'arm64')).toBe(false)
    expect(supportsCurrentPlatform({ os: [1] }, 'darwin', 'arm64')).toBe(false)
    expect(supportsCurrentPlatform({ os: ['darwin'], cpu: 'arm64' }, 'darwin', 'arm64')).toBe(false)
  })
})
