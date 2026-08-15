import { describe, expect, it } from 'vitest'
import { parseClawdshRoute, routePath } from '../src/router.ts'

describe('ClawDSH product routes', () => {
  it.each([
    ['/clawdsh/', 'chat'],
    ['/clawdsh', 'chat'],
    ['/clawdsh/settings', 'settings'],
    ['/clawdsh/settings/', 'settings'],
    ['/clawdsh/activity', 'activity'],
    ['/clawdsh/chat', 'not-found'],
    ['/clawdsh/harness', 'not-found'],
    ['/elsewhere', 'not-found'],
  ] as const)('maps %s to %s', (pathname, id) => {
    expect(parseClawdshRoute(pathname)).toEqual({ id, pathname })
  })

  it('keeps the conversation canonical at the product root', () => {
    expect(routePath('chat')).toBe('/clawdsh/')
    expect(routePath('settings')).toBe('/clawdsh/settings')
    expect(routePath('activity')).toBe('/clawdsh/activity')
  })
})
