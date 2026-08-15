import { type ReactNode } from 'react'
import css from './SettingsPage.module.css'

interface GatewayExtensionsTableProps {
  readonly value: unknown
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (Array.isArray(value)) return value.map(String).join('、')
  return value === undefined ? '—' : String(value)
}

/** Read-only locked Gateway extension inventory with no arbitrary JSON editor. */
export function GatewayExtensionsTable({ value }: GatewayExtensionsTableProps): ReactNode {
  const rows = Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
  if (rows.length === 0) return <span className={css.emptyValue}>未安装独立渠道扩展</span>
  return (
    <div className={css.tableWrap}>
      <table aria-label="OpenClaw Gateway 扩展">
        <thead><tr><th>插件</th><th>渠道</th><th>包</th><th>版本</th><th>完整性</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${cell(row, 'pluginId')}:${String(index)}`}>
              <td>{cell(row, 'pluginId')}</td>
              <td>{cell(row, 'channelIds')}</td>
              <td>{cell(row, 'packageName')}</td>
              <td>{cell(row, 'version')}</td>
              <td><code>{cell(row, 'integrity')}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
