import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { TREE_ALGORITHM, type HostTreeSummary } from './schema.ts'

const NUL = Buffer.from([0])

function collectOrdinaryFiles(root: string, directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === 'node_modules') continue
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) collectOrdinaryFiles(root, absolutePath, files)
    else if (entry.isFile()) files.push(absolutePath)
    else throw new Error(`host tree contains non-ordinary entry: ${absolutePath}`)
  }
}

/**
 * Summarizes an extracted npm package tree using path, byte length, and raw file digest records.
 *
 * The package's top-level `node_modules` is excluded because the separately locked
 * installed-project digest owns the complete dependency assembly.
 *
 * @param hostRoot Extracted or installed package root; any symbolic link or other non-ordinary package entry is rejected.
 * @returns The deterministic ordinary-file count and aggregate SHA-512 integrity.
 */
export function summarizeHostTree(hostRoot: string): HostTreeSummary {
  const absoluteRoot = resolve(hostRoot)
  if (!lstatSync(absoluteRoot).isDirectory()) throw new Error(`host root is not a directory: ${absoluteRoot}`)

  const files: string[] = []
  collectOrdinaryFiles(absoluteRoot, absoluteRoot, files)
  files.sort()

  const aggregate = createHash('sha512')
  for (const absolutePath of files) {
    const bytes = readFileSync(absolutePath)
    const relativePosixPath = relative(absoluteRoot, absolutePath).split(sep).join('/')
    const fileDigest = createHash('sha512').update(bytes).digest()
    aggregate.update(relativePosixPath)
    aggregate.update(NUL)
    aggregate.update(String(bytes.byteLength))
    aggregate.update(NUL)
    aggregate.update(fileDigest)
  }

  return {
    algorithm: TREE_ALGORITHM,
    fileCount: files.length,
    integrity: `sha512-${aggregate.digest('base64')}`,
  }
}

/**
 * Compares an extracted host tree with a lock summary.
 *
 * @param hostRoot Extracted package root.
 * @param expected Locked tree summary.
 * @returns Human-readable mismatches; an empty array means the tree matches.
 */
export function verifyHostTree(hostRoot: string, expected: HostTreeSummary): string[] {
  const actual = summarizeHostTree(hostRoot)
  const errors: string[] = []
  if (actual.algorithm !== expected.algorithm) {
    errors.push(`host tree algorithm: expected ${expected.algorithm}, got ${actual.algorithm}`)
  }
  if (actual.fileCount !== expected.fileCount) {
    errors.push(`host tree fileCount: expected ${expected.fileCount}, got ${actual.fileCount}`)
  }
  if (actual.integrity !== expected.integrity) {
    errors.push(`host tree integrity: expected ${expected.integrity}, got ${actual.integrity}`)
  }
  return errors
}
