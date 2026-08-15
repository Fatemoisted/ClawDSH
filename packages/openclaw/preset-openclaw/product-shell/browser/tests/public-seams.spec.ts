import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BROWSER_ROOT = process.cwd()
const SOURCE_ROOT = join(BROWSER_ROOT, 'src')

function sourceFiles(directory = SOURCE_ROOT): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(path)) ? [path] : []
  })
}

describe('ClawDSH browser public seams', () => {
  it('does not import private package sources or register a new Client slot', () => {
    const source = [
      ...sourceFiles().map(path => readFileSync(path, 'utf8')),
      readFileSync(join(BROWSER_ROOT, 'vite.config.ts'), 'utf8'),
    ].join('\n')
    const packageImports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])

    expect(packageImports.filter(specifier => specifier?.startsWith('@') && specifier.includes('/src/'))).toEqual([])
    expect(source).not.toContain('slots.register(')
    expect(source).not.toContain('ctx.slots.register(')
    expect(source).not.toMatch(/packages\/client\/[^'"\s]+\/src\//)
  })

  it('keeps the nested builder out of the Client catalog', () => {
    const manifest = JSON.parse(readFileSync(join(BROWSER_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).not.toHaveProperty('dsh')
    expect(JSON.stringify(manifest)).not.toContain('dsh.client')
    expect(JSON.stringify(manifest)).not.toContain('@deepseek-ai/dsh-api-remotes')
  })

  it('loads shared theme layers before product styles', () => {
    const css = readFileSync(join(SOURCE_ROOT, 'base.css'), 'utf8')
    const imports = css.match(/^@import .+;$/gm)
    expect(imports).toEqual([
      "@import '@deepseek-ai/dsh-client-ui-theme/styles/base.css';",
      "@import '@deepseek-ai/dsh-client-ui-theme/styles/design-platform.css';",
      "@import '@deepseek-ai/dsh-client-ui-theme/styles/scrollbar.css';",
      "@import '@deepseek-ai/dsh-client-ui-theme/styles/gradient-shadow-text.css';",
      "@import '@deepseek-ai/dsh-client-ui-theme/styles/shiki.css';",
    ])
  })
})
