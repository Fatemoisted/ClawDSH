import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationRulesEditor } from '../src/pages/AutomationRulesEditor.tsx'
import { GatewayExtensionsTable } from '../src/pages/GatewayExtensionsTable.tsx'
import { SettingsFields } from '../src/pages/settings-fields.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ClawDSH specialized settings editors', () => {
  it('edits Automation rules as one structured array', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('b9f2c9c7-6e2b-4dbf-a1ee-cb6b7b9e349d')
    const onChange = vi.fn()
    render(<AutomationRulesEditor id="rules" value={[]} disabled={false} onChange={onChange} />)

    expect(screen.getByText(/保存后还需要开启自动运行/)).toBeTruthy()
    expect(screen.getByText(/结果保存在.*独立对话/)).toBeTruthy()
    expect(screen.getByText(/每天 9 点整理待办/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加自动任务' }))
    expect(onChange).toHaveBeenCalledWith([
      {
        id: 'rule-b9f2c9c7-6e2b-4dbf-a1ee-cb6b7b9e349d',
        name: '',
        enabled: true,
        schedule: { kind: 'every', seconds: 3600 },
        message: '',
      },
    ])
  })

  it('does not reuse a deleted rule\'s durable session id', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('5e99098c-21a4-4ce8-974c-e5319527a15e')
    const onChange = vi.fn()
    const { rerender } = render(<AutomationRulesEditor
      id="rules"
      value={[
        { id: 'rule-1', name: '', enabled: true, schedule: { kind: 'every', seconds: 60 }, message: 'old' },
      ]}
      disabled={false}
      onChange={onChange}
    />)

    expect(screen.queryByRole('textbox', { name: '任务 ID' })).toBeNull()
    expect(screen.getByText('rule-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    rerender(<AutomationRulesEditor id="rules" value={[]} disabled={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '添加自动任务' }))
    const added = onChange.mock.lastCall?.[0] as Array<{ id: string }>
    expect(added[0]?.id).toBe('rule-5e99098c-21a4-4ce8-974c-e5319527a15e')
    expect(added[0]?.id).not.toBe('rule-1')
    expect(added[0]?.id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('uses labels only for native controls and groups readonly or specialized fields', () => {
    render(
      <SettingsFields
        idPrefix="settings"
        serializedSchema={{ uid: 1, refs: { 1: { type: 'object', meta: { default: {} }, dict: {} } } }}
        draft={{ managed: 'locked', rules: [], extensions: [] }}
        fields={[
          { path: ['managed'], label: '只读字段', editable: false },
          { path: ['rules'], label: 'Automation 规则', editable: true },
          { path: ['extensions'], label: 'Gateway 扩展', editable: false },
        ]}
        disabled={false}
        onChange={() => undefined}
        renderSpecial={(field, value, onChange) => {
          const key = field.path.join('.')
          if (key === 'rules') {
            return <AutomationRulesEditor id="settings-rules" value={value} disabled={false} onChange={onChange} />
          }
          if (key === 'extensions') return <GatewayExtensionsTable value={value} />
          return undefined
        }}
      />,
    )

    expect(document.querySelectorAll('label[for]')).toHaveLength(0)
    expect(screen.getByRole('group', { name: '只读字段' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Automation 规则' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Gateway 扩展' })).toBeTruthy()
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
