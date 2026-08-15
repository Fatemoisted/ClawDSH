import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StagedMediaGuard } from '../shared/media.js'

test('imports and re-verifies media beneath the staging root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clawdsh-media-'))
  await chmod(root, 0o700)
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  await mkdir(join(root, 'inbound'))
  const path = join(root, 'inbound', 'picture.bin')
  const bytes = Buffer.from('fixture media')
  await writeFile(path, bytes)
  const guard = new StagedMediaGuard(root, 1024)
  const [reference] = await guard.importFacts([{
    path,
    kind: 'image',
    contentType: 'image/png',
    fileName: '../picture.png',
    sizeBytes: bytes.byteLength,
  }])
  assert.deepEqual(reference, {
    mediaId: createHash('sha256').update(`0\0inbound/picture.bin\0${createHash('sha256').update(bytes).digest('hex')}`).digest('hex'),
    ordinal: 0,
    kind: 'image',
    mediaType: 'image/png',
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    relativePath: 'inbound/picture.bin',
    name: 'picture.png',
  })
  const [verified] = await guard.verifyReferences([reference])
  assert.equal(verified.absolutePath, await realpath(path))
  assert.deepEqual(verified.bytes, bytes)
})

test('rejects path escape, symlinks, remote URLs, and changed bytes', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'clawdsh-media-security-'))
  const root = join(parent, 'root')
  await mkdir(root)
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(parent, { recursive: true, force: true })) })
  const outside = join(parent, 'outside.bin')
  await writeFile(outside, 'outside')
  await symlink(outside, join(root, 'link.bin'))
  const guard = new StagedMediaGuard(root, 1024)
  await assert.rejects(() => guard.importFacts([{ path: outside }]), /escapes/)
  await assert.rejects(() => guard.importFacts([{ path: join(root, 'link.bin') }]), /symbolic link/)
  await assert.rejects(() => guard.importFacts([{ url: 'https://example.test/media' }]), /remote inbound media/)

  const safe = join(root, 'safe.bin')
  await writeFile(safe, 'first')
  const [reference] = await guard.importFacts([{ path: safe }])
  await writeFile(safe, 'second')
  await assert.rejects(() => guard.verifyReferences([reference]), /no longer matches/)
})

test('rejects a staged object before reading beyond the configured byte cap', async t => {
  const root = await mkdtemp(join(tmpdir(), 'clawdsh-media-limit-'))
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  const path = join(root, 'oversized.bin')
  await writeFile(path, Buffer.alloc(9, 1))
  const guard = new StagedMediaGuard(root, 8)
  await assert.rejects(() => guard.importFacts([{ path }]), /outside the configured limit/)
})
