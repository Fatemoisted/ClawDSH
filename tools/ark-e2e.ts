/**
 * 真实 ARK embeddings e2e —— 用法: node --import tsx/esm tools/ark-e2e.ts
 *
 * 不碰模型、不碰渠道：挂真实 LocalFileSystem + ArkEmbeddings + Memory，写两条真实
 * 记忆（语义相关/无关各一），经 ctx.tools.execute 走 memory_search，验证真实
 * embedding 召回的排序与分数，并打印 provider 返回的向量维度。wire shape 实测
 * 记录见 docs/journal。
 *
 * API key：本脚本自行解析根 `.env` 的 ARK_API_KEY 并作为字面量传入——裸 Context
 * 没有 CLI 启动器的 launch-environment 分层（project-env/user-env 由 dsh CLI
 * boot 注入），credentials 分层的正确性由 embeddings-ark 契约测试覆盖，这里只
 * 验证真实 wire。缺 ARK_API_KEY 时 fail-loud。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ArkEmbeddings } from '@clawdsh/dsh-embeddings-ark'
import * as Memory from '@clawdsh/dsh-memory'

function apiKeyFromDotenv(): string | undefined {
  for (const line of readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8').split('\n')) {
    const match = /^ARK_API_KEY=(.+)$/.exec(line.trim())
    if (match !== null && match[1]!.length > 0) return match[1]
  }
  return undefined
}

const apiKey = process.env.ARK_API_KEY ?? apiKeyFromDotenv()
if (apiKey === undefined) {
  throw new Error('ARK_API_KEY not found: export it, or set it in the repo root .env (gitignored)')
}

const dir = mkdtempSync(join(tmpdir(), 'clawdsh-ark-e2e-'))
const ctx = new Context()
try {
  mkdirSync(join(dir, 'memory'))
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(ArkEmbeddings, { apiKey })

  const vectors = await ctx.embeddings.embed(['hello', '世界'])
  console.log(`== provider ok: 2 texts -> ${vectors.length} vectors, dimension ${vectors[0]?.length ?? 'unknown'}`)
  if ((vectors[0]?.length ?? 0) < 1) throw new Error('empty vectors returned')

  await ctx.fs.writeText(await ctx.fs.resolve(join(dir, 'MEMORY.md')), 'The user prefers banana smoothies for breakfast.\n')
  await ctx.fs.writeText(await ctx.fs.resolve(join(dir, 'memory', '2026-08-14.md')), 'Discussed the tax deadline today. It moved to September.\n')
  await ctx.plugin(Memory, { root: dir })

  let callId = 0
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `ark-e2e-${++callId}`,
    name: 'memory_search',
    arguments: { query: 'what does the user like for breakfast' },
  })
  if (result.isError) throw new Error(`memory_search failed: ${JSON.stringify(result.content)}`)
  const output = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  console.log('== memory_search result:\n' + output)
  if (!output.includes('MEMORY.md')) throw new Error('expected the MEMORY.md hit first')
  if (!output.includes('smoothies')) throw new Error('expected the smoothies snippet in the hit')
  const score = /score ([\d.]+)/.exec(output)?.[1]
  console.log(`== recall ok: top hit score ${score ?? '(unparsed)'}`)

  const filtered = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `ark-e2e-${++callId}`,
    name: 'memory_search',
    arguments: { query: 'quantum chromodynamics gauge bosons', minScore: 0.5 },
  })
  if (filtered.isError) throw new Error(`filtered search failed: ${JSON.stringify(filtered.content)}`)
  const filteredText = filtered.content.filter(block => block.type === 'text').map(block => block.text).join('')
  if (!filteredText.includes('No matching memories found')) {
    throw new Error(`expected the unrelated query to find nothing, got:\n${filteredText}`)
  }
  console.log('== unrelated query correctly filtered out')
  console.log('== ARK e2e PASS')
} finally {
  // Process exits right after; the temp dir is the only cleanup that matters.
  rmSync(dir, { recursive: true, force: true })
}
