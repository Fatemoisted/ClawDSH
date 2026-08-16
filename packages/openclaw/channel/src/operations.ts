/**
 * Per-key asynchronous operation serialization shared by channel implementations.
 * @module @clawdsh/dsh-channel/operations
 */

/**
 * Append one asynchronous operation to a per-key promise tail.
 *
 * Operations sharing a key run in admission order, while operations for different keys remain
 * independent. A rejected operation does not poison its key's tail, and an idle tail removes
 * itself without deleting a newer operation admitted for the same key.
 *
 * @param operations - Mutable registry of settled promise tails, owned by the caller.
 * @param key - Identity whose operations must not overlap.
 * @param operation - Work admitted after the prior operation for the key settles.
 * @returns The exact result or rejection produced by `operation`.
 */
export function serializeKeyedOperation<Key, Result>(
  operations: Map<Key, Promise<void>>,
  key: Key,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = operations.get(key) ?? Promise.resolve()
  const running = previous.then(operation, operation)
  const tail = running.then(() => undefined, () => undefined)
  operations.set(key, tail)
  void tail.then(() => {
    if (operations.get(key) === tail) operations.delete(key)
  })
  return running
}
