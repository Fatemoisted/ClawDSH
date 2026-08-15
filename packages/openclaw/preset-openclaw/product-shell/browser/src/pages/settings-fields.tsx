import {
  getPath,
  nodeAtPath,
  rehydrateSchema,
  setPath,
  type SchemaNode,
} from '@deepseek-ai/dsh-client-schema-form'
import { useMemo, type ReactNode } from 'react'
import css from './SettingsPage.module.css'

/** Product copy and authorization metadata for one schema-owned setting. */
export interface SettingsFieldPresentation {
  readonly path: readonly string[]
  readonly label: string
  readonly description?: string
  readonly editable: boolean
  readonly editor?: 'auto' | 'automation-rules' | 'gateway-extensions'
}

interface SettingsFieldsProps {
  readonly idPrefix: string
  readonly serializedSchema: unknown
  readonly draft: Record<string, unknown>
  readonly fields: readonly SettingsFieldPresentation[]
  readonly disabled: boolean
  readonly onChange: (draft: Record<string, unknown>) => void
  readonly renderSpecial?: (
    field: SettingsFieldPresentation,
    value: unknown,
    onChange: (value: unknown) => void,
  ) => ReactNode | undefined
}

function pathKey(path: readonly string[]): string {
  return path.join('.')
}

function enumValues(node: SchemaNode): readonly (string | number)[] | undefined {
  if (node.type !== 'union' || node.list === undefined) return undefined
  const values = node.list.map(item => item.type === 'const' ? item.value : undefined)
  if (values.some(value => typeof value !== 'string' && typeof value !== 'number')) return undefined
  return values as readonly (string | number)[]
}

function readonlyValue(value: unknown): ReactNode {
  if (value === undefined || value === '') return <span className={css.emptyValue}>未配置</span>
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={css.emptyValue}>空列表</span>
    return (
      <ul className={css.readonlyList}>
        {value.map((item, index) => <li key={String(index)}>{String(item)}</li>)}
      </ul>
    )
  }
  if (typeof value === 'object' && value !== null) {
    return <span className={css.emptyValue}>由安装器管理</span>
  }
  return <code>{String(value)}</code>
}

function editableControl(
  id: string,
  node: SchemaNode,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
): ReactNode {
  const choices = enumValues(node)
  if (choices !== undefined) {
    return (
      <select
        id={id}
        value={value === undefined ? '' : String(value)}
        disabled={disabled}
        onChange={(event) => {
          const selected = choices.find(choice => String(choice) === event.target.value)
          onChange(selected)
        }}
      >
        {choices.map(choice => <option key={String(choice)} value={String(choice)}>{String(choice)}</option>)}
      </select>
    )
  }
  if (node.type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.checked) }}
      />
    )
  }
  if (node.type === 'number') {
    return (
      <input
        id={id}
        type="number"
        value={typeof value === 'number' && Number.isFinite(value) ? String(value) : ''}
        min={node.meta.min}
        max={node.meta.max}
        step={node.meta.step}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }}
      />
    )
  }
  if (node.type === 'array' && node.inner?.type === 'string') {
    return (
      <textarea
        id={id}
        value={Array.isArray(value) ? value.join('\n') : ''}
        disabled={disabled}
        rows={Math.max(3, Array.isArray(value) ? value.length + 1 : 3)}
        onChange={(event) => {
          onChange(event.target.value.split('\n').map(item => item.trim()).filter(Boolean))
        }}
      />
    )
  }
  if (node.type === 'string') {
    return (
      <input
        id={id}
        type="text"
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value) }}
      />
    )
  }
  return readonlyValue(value)
}

/** Schema-driven controls with product-owned labels and edit permissions. */
export function SettingsFields({
  idPrefix,
  serializedSchema,
  draft,
  fields,
  disabled,
  onChange,
  renderSpecial,
}: SettingsFieldsProps): ReactNode {
  const schema = useMemo(() => rehydrateSchema(serializedSchema), [serializedSchema])
  return (
    <div className={css.settingsFields}>
      {fields.map((field) => {
        const key = pathKey(field.path)
        const id = `${idPrefix}-${key.replaceAll('.', '-')}`
        const node = nodeAtPath(schema, field.path)
        const value = getPath(draft, field.path)
        const update = (next: unknown): void => { onChange(setPath(draft, field.path, next)) }
        const special = renderSpecial?.(field, value, update)
        return (
          <div className={css.settingField} key={key} data-setting-path={key}>
            <div className={css.fieldCopy}>
              <label htmlFor={id}>{field.label}</label>
              {field.editable ? null : <span className={css.managed}>安装器管理</span>}
              {field.description === undefined ? null : <p>{field.description}</p>}
            </div>
            <div className={css.fieldControl}>
              {special ?? (node === undefined || !field.editable
                ? readonlyValue(value)
                : editableControl(id, node, value, disabled, update))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
