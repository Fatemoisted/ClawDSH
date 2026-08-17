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
  it('uses only public package exports and the five approved Slot contributions', () => {
    const source = [
      ...sourceFiles().map(path => readFileSync(path, 'utf8')),
      readFileSync(join(BROWSER_ROOT, 'vite.config.ts'), 'utf8'),
    ].join('\n')
    const packageImports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])

    expect(packageImports.filter(specifier => specifier?.startsWith('@') && specifier.includes('/src/'))).toEqual([])
    expect(source.match(/ctx\.slots\.register\(/g)).toHaveLength(5)
    for (const name of [
      'conversation.hero.agentPreset',
      'sidebar.footer.action',
      'settings.section',
      'conversation.view',
      'conversation.chat.node',
    ]) expect(source).toContain(`name: '${name}'`)
    expect(source).toContain('priority: -1')
    expect(source).not.toMatch(/packages\/client\/[^'"\s]+\/src\//)
    expect(source).not.toMatch(/\.querySelector(?:All)?\s*\(/)
    expect(source).not.toMatch(/\.click\s*\(/)
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

  it('keeps a minimal native root and responsive feature content', () => {
    const shell = readFileSync(join(SOURCE_ROOT, 'ProductShell.module.css'), 'utf8')
    const activity = readFileSync(join(SOURCE_ROOT, 'pages/ActivityPage.module.css'), 'utf8')
    const settings = readFileSync(join(SOURCE_ROOT, 'pages/SettingsPage.module.css'), 'utf8')
    const boot = readFileSync(join(SOURCE_ROOT, 'ClawdshBootRoot.module.css'), 'utf8')

    expect(shell).toContain(":global([data-variant='think'])")
    expect(shell).not.toContain('grid-template-columns')
    expect(shell).toContain('.advancedActionRail')
    expect(shell).toContain('.advancedAction:focus-visible')
    expect(shell).toContain('[data-sidebar-collapsed]:has([role=\'dialog\'][aria-modal=\'true\'])')
    expect(activity).toContain('@media (max-width: 720px)')
    expect(activity).toContain('.controls { align-items: stretch; flex-direction: column; }')
    expect(settings).toContain('@media (max-width: 720px)')
    expect(settings).toContain('color: var(--dsw-alias-bg-base)')
    expect(settings).not.toContain('var(--dsw-alias-brand-primary-invert)')
    expect(boot).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('declares product metadata and public brand assets below the ClawDSH base path', () => {
    const html = readFileSync(join(BROWSER_ROOT, 'index.html'), 'utf8')

    expect(html).toContain('href="/clawdsh/favicon.svg"')
    expect(html).toContain('href="/clawdsh/manifest.webmanifest"')
    expect(html).toContain('<div id="root"><div id="clawdsh-root"></div></div>')
    expect(html).toContain('OpenClaw capabilities, rebuilt as composable dsh plugins.')
  })
})
