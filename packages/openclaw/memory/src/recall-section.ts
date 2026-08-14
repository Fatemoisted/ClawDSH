/**
 * The static `## Memory Recall` guidance section. Deliberately a fixed model-facing text (pin it
 * verbatim in tests): it teaches the recall workflow and the write convention,
 * matching OpenClaw's own `## Memory Recall` section — recall is on-demand via
 * tools, never auto-injected per request.
 *
 * @module @clawdsh/dsh-memory/recall-section
 */

/** Prompt-section name; unique within the system-prompt registry. */
export const MEMORY_RECALL_SECTION = 'clawdsh:memory-recall'

/** Order band: tool guidance lives at 100–199 (`tool:session-query` uses 113); memory recall uses 115. */
export const MEMORY_RECALL_ORDER = 115

/** Stable model-facing guidance text. */
export const RECALL_TEXT =
  'Use memory_search to recall facts about people, preferences, decisions, and prior work from '
  + 'MEMORY.md and memory/*.md before answering questions about them; follow a strong hit with '
  + 'memory_get to read the needed lines. To remember something, use memory_append: append running '
  + 'notes to memory/YYYY-MM-DD.md and durable facts to MEMORY.md — append, never rewrite history.'
