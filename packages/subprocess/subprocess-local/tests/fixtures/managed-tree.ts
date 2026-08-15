import { spawn } from 'node:child_process'
// This fixture is launched directly by Node before the workspace is built, so
// use the package's public source export instead of its generated `lib` entry.
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write/src/index.ts'

const [statePath] = process.argv.slice(2)
if (statePath === undefined) throw new Error('usage: managed-tree.ts <state-path>')

process.on('SIGTERM', () => {})
process.on('SIGHUP', () => {})
const descendant = spawn(process.execPath, [
  '-e',
  'process.on("SIGTERM",()=>{});process.on("SIGHUP",()=>{});setInterval(()=>{},60_000)',
], { stdio: 'ignore' })
if (descendant.pid === undefined) throw new Error('managed descendant did not publish a pid')

await writeFileAtomic(statePath, JSON.stringify({ root: process.pid, descendant: descendant.pid }), { mode: 0o600 })
setInterval(() => {}, 60_000)
