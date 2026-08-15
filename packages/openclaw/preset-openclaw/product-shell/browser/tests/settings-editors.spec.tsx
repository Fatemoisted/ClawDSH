import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { AutomationRulesEditor } from '../src/pages/AutomationRulesEditor.tsx'
import { GatewayExtensionsTable } from '../src/pages/GatewayExtensionsTable.tsx'
import { SettingsFields } from '../src/pages/settings-fields.tsx'

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

  it('does not reuse an Automation rule ID after deleting and adding rules', () => {
    function Fixture() {
      const [rules, setRules] = useState<unknown>([
        { id: 'rule-1', name: 'first', enabled: true, schedule: { kind: 'every', seconds: 60 }, message: 'one' },
        { id: 'rule-2', name: 'second', enabled: true, schedule: { kind: 'every', seconds: 60 }, message: 'two' },
      ])
      return <AutomationRulesEditor id="rules" value={rules} disabled={false} onChange={setRules} />
    }

    render(<Fixture />)
    fireEvent.click(screen.getAllByRole('button', { name: '删除规则' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))

    const ids = screen.getAllByLabelText('规则 ID').map(input => (input as HTMLInputElement).value)
    expect(ids).toEqual(['rule-2', 'rule-3'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not freeze when an existing Automation rule has an unsafe numeric suffix', () => {
    const onChange = vi.fn()
    render(<AutomationRulesEditor
      id="rules"
      value={[
        {
          id: 'rule-9007199254740992',
          name: 'imported',
          enabled: true,
          schedule: { kind: 'every', seconds: 60 },
          message: 'work',
        },
      ]}
      disabled={false}
      onChange={onChange}
    />)

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'rule-2' }),
    ]))
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
