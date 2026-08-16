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
  'Use memory_search to recall facts about people, preferences, decisions, and prior work before answering questions about them; '
  + 'follow a strong hit with memory_get to read the needed lines. If semantic search is unavailable, read MEMORY.md directly with '
  + 'memory_get instead of giving up. Proactively call memory_write when the user states '
  + 'a stable identity, preference, decision, relationship, or long-lived project: use scope durable for lasting facts and scope daily '
  + 'for running notes. For a correction or forget request, read MEMORY.md first, then call memory_update with the exact old line; never '
  + 'append a contradiction. Never store credentials, authentication secrets, transient details, or anything the user asks you not to '
  + 'retain. Read and write personal memory only through memory_search, memory_get, memory_write, and memory_update; never use general '
  + 'filesystem tools for the memory store.'
