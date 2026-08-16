import { describe, expect, it } from 'vitest'
import { serializeKeyedOperation } from '../src/index.ts'

describe('serializeKeyedOperation', () => {
  it('runs one key in admission order and retains a newer tail during cleanup', async () => {
    const operations = new Map<string, Promise<void>>()
    const releaseFirst = Promise.withResolvers<undefined>()
    const releaseSecond = Promise.withResolvers<undefined>()
    const entered: string[] = []
    const first = serializeKeyedOperation(operations, 'shared', async () => {
      entered.push('first')
      await releaseFirst.promise
      return 1
    })
    const second = serializeKeyedOperation(operations, 'shared', async () => {
      entered.push('second')
      await releaseSecond.promise
      return 2
    })

    await Promise.resolve()
    expect(entered).toEqual(['first'])
    releaseFirst.resolve(undefined)
    await expect(first).resolves.toBe(1)
    await Promise.resolve()
    expect(entered).toEqual(['first', 'second'])
    expect(operations.has('shared')).toBe(true)
    releaseSecond.resolve(undefined)
    await expect(second).resolves.toBe(2)
    await Promise.resolve()
    expect(operations.has('shared')).toBe(false)
  })

  it('does not block different keys', async () => {
    const operations = new Map<string, Promise<void>>()
    const release = Promise.withResolvers<undefined>()
    const entered: string[] = []
    const first = serializeKeyedOperation(operations, 'first', async () => {
      entered.push('first')
      await release.promise
    })
    const second = serializeKeyedOperation(operations, 'second', async () => {
      entered.push('second')
      await release.promise
    })

    await Promise.resolve()
    expect(entered).toEqual(['first', 'second'])
    release.resolve(undefined)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it('continues one key after a rejection and cleans the settled tail', async () => {
    const operations = new Map<string, Promise<void>>()
    const failed = serializeKeyedOperation(operations, 'shared', async () => {
      throw new Error('expected failure')
    })
    const recovered = serializeKeyedOperation(operations, 'shared', async () => 'recovered')

    await expect(failed).rejects.toThrow('expected failure')
    await expect(recovered).resolves.toBe('recovered')
    await Promise.resolve()
    expect(operations.size).toBe(0)
  })

  it('cleans a rejected operation when it is the last tail', async () => {
    const operations = new Map<string, Promise<void>>()
    const failed = serializeKeyedOperation(operations, 'failed', async () => {
      throw new Error('expected failure')
    })

    await expect(failed).rejects.toThrow('expected failure')
    await Promise.resolve()
    expect(operations.size).toBe(0)
  })
})
