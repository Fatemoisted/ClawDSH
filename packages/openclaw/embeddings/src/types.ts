/**
 * Vocabulary for the embeddings Service Definition. Types only — the abstract
 * service lives in `./index.ts`, implementations in sibling packages
 * (`@clawdsh/dsh-embeddings-ark` first).
 *
 * @module @clawdsh/dsh-embeddings/types
 */

/** One dense text embedding: a non-empty list of floats in a provider-chosen dimension. */
export type EmbeddingVector = number[]
