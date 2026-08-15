import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationRulesEditor } from '../src/pages/AutomationRulesEditor.tsx'
import { GatewayExtensionsTable } from '../src/pages/GatewayExtensionsTable.tsx'

afterEach(cleanup)

describe('ClawDSH specialized settings editors', () => {
  it('edits Automation rules as one structured array', () => {
    const onChange = vi.fn()
    render(<AutomationRulesEditor id="rules" value={[]} disabled={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    expect(onChange).toHaveBeenCalledWith([
      {
        id: 'rule-1',
        name: '',
        enabled: true,
        schedule: { kind: 'every', seconds: 3600 },
        message: '',
      },
    ])
  })

  it('shows locked Gateway extensions without an editable JSON field', () => {
    render(<GatewayExtensionsTable value={[{
      pluginId: 'openclaw-feishu',
      channelIds: ['feishu'],
      packageName: '@openclaw/feishu',
      version: '1.2.3',
      integrity: 'sha512-canary',
    }]} />)

    expect(screen.getByRole('table', { name: 'OpenClaw Gateway 扩展' })).toBeTruthy()
    expect(screen.getByText('openclaw-feishu')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
