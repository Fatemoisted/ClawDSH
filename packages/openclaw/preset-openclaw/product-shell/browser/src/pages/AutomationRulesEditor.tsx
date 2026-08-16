import { type ReactNode } from 'react'
import css from './SettingsPage.module.css'

interface RuleRecord {
  readonly id: string
  readonly name: string
  readonly message: string
  readonly enabled: boolean
  readonly schedule: Record<string, unknown>
}

interface AutomationRulesEditorProps {
  readonly id: string
  readonly value: unknown
  readonly disabled: boolean
  readonly onChange: (value: unknown) => void
}

function rulesOf(value: unknown): RuleRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((candidate, index) => {
    const row = typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {}
    const schedule = typeof row.schedule === 'object' && row.schedule !== null && !Array.isArray(row.schedule)
      ? row.schedule as Record<string, unknown>
      : { kind: 'every', seconds: 3600 }
    return {
      id: typeof row.id === 'string' ? row.id : `rule-${String(index + 1)}`,
      name: typeof row.name === 'string' ? row.name : '',
      message: typeof row.message === 'string' ? row.message : '',
      enabled: row.enabled !== false,
      schedule,
    }
  })
}

function replaceRule(rules: RuleRecord[], index: number, patch: Partial<RuleRecord>): RuleRecord[] {
  return rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule)
}

function nextRuleId(rules: readonly RuleRecord[]): string {
  const ids = new Set(rules.map(rule => rule.id))
  // Starting just beyond the number of rows guarantees a free suffix after
  // at most `rules.length` probes, without parsing user-controlled digits into
  // an imprecise Number (which could otherwise stop incrementing forever).
  let sequence = rules.length + 1
  while (ids.has(`rule-${String(sequence)}`)) sequence += 1
  return `rule-${String(sequence)}`
}

function scheduleKind(schedule: Record<string, unknown>): 'cron' | 'at' | 'every' {
  return schedule.kind === 'cron' || schedule.kind === 'at' ? schedule.kind : 'every'
}

/** Structured Automation rules editor; rules never pass through an arbitrary JSON control. */
export function AutomationRulesEditor({ id, value, disabled, onChange }: AutomationRulesEditorProps): ReactNode {
  const rules = rulesOf(value)
  return (
    <div className={css.ruleEditor} id={id}>
      {rules.length === 0 ? <p className={css.emptyValue}>尚未配置自动化规则。</p> : null}
      {rules.map((rule, index) => {
        const kind = scheduleKind(rule.schedule)
        const update = (patch: Partial<RuleRecord>): void => { onChange(replaceRule(rules, index, patch)) }
        const updateSchedule = (patch: Record<string, unknown>): void => {
          update({ schedule: { ...rule.schedule, ...patch } })
        }
        return (
          <fieldset className={css.rule} key={`${rule.id}:${String(index)}`} disabled={disabled}>
            <legend>规则 {String(index + 1)}</legend>
            <label>规则 ID<input value={rule.id} onChange={(event) => { update({ id: event.target.value }) }} /></label>
            <label>名称<input value={rule.name} onChange={(event) => { update({ name: event.target.value }) }} /></label>
            <label className={css.checkboxLabel}>
              <input type="checkbox" checked={rule.enabled} onChange={(event) => { update({ enabled: event.target.checked }) }} />
              启用此规则
            </label>
            <label>
              调度方式
              <select
                value={kind}
                onChange={(event) => {
                  const next = event.target.value
                  update({
                    schedule: next === 'cron'
                      ? { kind: 'cron', expr: '0 * * * *', timeZone: '' }
                      : next === 'at'
                        ? { kind: 'at', at: new Date(Date.now() + 3_600_000).toISOString() }
                        : { kind: 'every', seconds: 3600 },
                  })
                }}
              >
                <option value="every">固定间隔</option>
                <option value="cron">Cron</option>
                <option value="at">单次时间</option>
              </select>
            </label>
            {kind === 'every' ? (
              <label>
                间隔秒数
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={typeof rule.schedule.seconds === 'number' ? String(rule.schedule.seconds) : ''}
                  onChange={(event) => { updateSchedule({ seconds: Number(event.target.value) }) }}
                />
              </label>
            ) : null}
            {kind === 'cron' ? (
              <>
                <label>Cron 表达式<input value={String(rule.schedule.expr ?? '')} onChange={(event) => { updateSchedule({ expr: event.target.value }) }} /></label>
                <label>时区<input value={String(rule.schedule.timeZone ?? '')} placeholder="Asia/Shanghai" onChange={(event) => { updateSchedule({ timeZone: event.target.value }) }} /></label>
              </>
            ) : null}
            {kind === 'at' ? (
              <label>执行时间（ISO 8601）<input value={String(rule.schedule.at ?? '')} onChange={(event) => { updateSchedule({ at: event.target.value }) }} /></label>
            ) : null}
            <label className={css.messageField}>
              任务消息
              <textarea
                rows={4}
                value={rule.message}
                onChange={(event) => { update({ message: event.target.value }) }}
              />
            </label>
            <button type="button" className={css.secondaryButton} onClick={() => { onChange(rules.filter((_, position) => position !== index)) }}>删除规则</button>
          </fieldset>
        )
      })}
      <button
        type="button"
        className={css.secondaryButton}
        disabled={disabled}
        onClick={() => {
          onChange([...rules, {
            id: nextRuleId(rules),
            name: '',
            enabled: true,
            schedule: { kind: 'every', seconds: 3600 },
            message: '',
          }])
        }}
      >
        添加规则
      </button>
    </div>
  )
}
