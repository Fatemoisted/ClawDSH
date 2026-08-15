#!/usr/bin/env node
/** Self-executing ClawDSH command-line entry. */

import { runCli } from './index.mjs'

try {
  process.exitCode = await runCli(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`clawdsh: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
