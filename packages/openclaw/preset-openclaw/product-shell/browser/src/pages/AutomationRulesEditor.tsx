import { type ReactNode } from 'react'
import css from './SettingsPage.module.css'

interface RuleRecord {
  readonly id: string
  readonly name: string
  readonly message: string
  readonly enabled: boolean
  readonly schedule: Record<string, unknown>
  readonly delivery?: unknown
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
      ...(Object.hasOwn(row, 'delivery') ? { delivery: row.delivery } : {}),
    }
  })
}

function replaceRule(rules: RuleRecord[], index: number, patch: Partial<RuleRecord>): RuleRecord[] {
  return rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule)
}

function scheduleKind(schedule: Record<string, unknown>): 'cron' | 'at' | 'every' {
  return schedule.kind === 'cron' || schedule.kind === 'at' ? schedule.kind : 'every'
}

function newRuleId(): string {
  return `rule-${crypto.randomUUID()}`
}

/** Structured Automation rules editor; rules never pass through an arbitrary JSON control. */
export function AutomationRulesEditor({ id, value, disabled, onChange }: AutomationRulesEditorProps): ReactNode {
  const rules = rulesOf(value)
  return (
    <div className={css.ruleEditor} id={id}>
      <p className={css.emptyValue}>
        每个自动任务由“什么时候运行”和“让 ClawDSH 做什么”组成。保存后会立即应用，无需重启 ClawDSH。
      </p>
      <p className={css.emptyValue}>
        任务结果会保存在以“自动任务 · 任务名”命名的独立对话中；从飞书等渠道创建的任务还会把最终回复发送回原会话。
      </p>
      {rules.length === 0 ? (
        <p className={css.emptyValue}>
          还没有自动任务。你可以设置每天 9 点整理待办、每周生成研究回顾，或在指定时间执行一次提醒。
        </p>
      ) : null}
      {rules.map((rule, index) => {
        const kind = scheduleKind(rule.schedule)
        const update = (patch: Partial<RuleRecord>): void => { onChange(replaceRule(rules, index, patch)) }
        const updateSchedule = (patch: Record<string, unknown>): void => {
          update({ schedule: { ...rule.schedule, ...patch } })
        }
        return (
          <fieldset className={css.rule} key={`${rule.id}:${String(index)}`} disabled={disabled}>
            <legend>自动任务 {String(index + 1)}</legend>
            <div className={css.fieldCopy}>
              <span className={css.fieldLabel}>任务标识</span>
              <code>{rule.id}</code>
            </div>
            <label>任务名称<input value={rule.name} onChange={(event) => { update({ name: event.target.value }) }} /></label>
            <label className={css.checkboxLabel}>
              <input type="checkbox" checked={rule.enabled} onChange={(event) => { update({ enabled: event.target.checked }) }} />
              启用此任务
            </label>
            <label>
              运行方式
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
                每隔多少秒
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
              让 ClawDSH 做什么
              <textarea
                rows={4}
                value={rule.message}
                onChange={(event) => { update({ message: event.target.value }) }}
              />
            </label>
            <button type="button" className={css.secondaryButton} onClick={() => { onChange(rules.filter((_, position) => position !== index)) }}>删除任务</button>
          </fieldset>
        )
      })}
      <button
        type="button"
        className={css.secondaryButton}
        disabled={disabled}
        onClick={() => {
          onChange([...rules, {
            id: newRuleId(),
            name: '',
            enabled: true,
            schedule: { kind: 'every', seconds: 3600 },
            message: '',
          }])
        }}
      >
        添加自动任务
      </button>
    </div>
  )
}
