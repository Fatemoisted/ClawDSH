import type { ReactNode } from 'react'
import type {
  ClawdshActivityRecord,
  ClawdshActivityStatus,
} from '../../../shared/src/protocol.ts'
import css from './ActivityPage.module.css'

interface ActivityRecordCardProps {
  readonly record: ClawdshActivityRecord
}

interface ActivityFrameProps extends ActivityRecordCardProps {
  readonly title: string
  readonly mark: string
  readonly children: ReactNode
}

const CATEGORY_LABEL = {
  prompt: 'Soul / Prompt',
  memory: 'Memory',
  channel: 'Channels',
  skill: 'Skills',
  automation: 'Automation',
} as const

const STATUS_LABEL: Readonly<Record<ClawdshActivityStatus, string>> = {
  started: '已开始',
  succeeded: '已完成',
  failed: '失败',
  sent: '已发送',
}

function ActivityFrame({ record, title, mark, children }: ActivityFrameProps): ReactNode {
  return (
    <article className={css.record} data-category={record.category} data-kind={record.kind}>
      <div className={css.recordMark} aria-hidden="true">{mark}</div>
      <div className={css.recordBody}>
        <header className={css.recordHeader}>
          <div>
            <span className={css.category}>{CATEGORY_LABEL[record.category]}</span>
            <h3>{title}</h3>
          </div>
          <div className={css.recordState}>
            {record.status === undefined ? null : (
              <span className={css.status} data-status={record.status}>{STATUS_LABEL[record.status]}</span>
            )}
            <time dateTime={record.timestamp}>{formatTimestamp(record.timestamp)}</time>
          </div>
        </header>
        <dl className={css.metadata}>{children}</dl>
      </div>
    </article>
  )
}

function Detail({ label, value, code = false }: {
  readonly label: string
  readonly value: ReactNode
  readonly code?: boolean
}): ReactNode {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{code ? <code>{value}</code> : value}</dd>
    </div>
  )
}

function PromptContributionCard({ record }: ActivityRecordCardProps): ReactNode {
  const metadata = record.metadata
  return (
    <ActivityFrame record={record} title="ClawDSH Prompt 贡献" mark="P">
      <Detail label="区段" value={metadata.section} code />
      <Detail label="方式" value={metadata.mode === 'replace' ? '替换' : '追加'} />
      <Detail label="字符数" value={metadata.characters} />
      <Detail label="SHA-256" value={metadata.sha256} code />
      <Detail label="Session Seq" value={metadata.seq} />
    </ActivityFrame>
  )
}

function MemorySearchCard({ record }: ActivityRecordCardProps): ReactNode {
  return <WorkCard record={record} title="Memory 搜索" mark="M" />
}

function MemoryReadCard({ record }: ActivityRecordCardProps): ReactNode {
  return <WorkCard record={record} title="Memory 读取" mark="M" />
}

function MemoryFlushCard({ record }: ActivityRecordCardProps): ReactNode {
  return <WorkCard record={record} title="Memory 写回" mark="M" />
}

function WorkCard({ record, title, mark }: ActivityRecordCardProps & {
  readonly title: string
  readonly mark: string
}): ReactNode {
  return (
    <ActivityFrame record={record} title={title} mark={mark}>
      <Detail label="Session Seq" value={record.metadata.seq} />
    </ActivityFrame>
  )
}

function ChannelReceivedCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame record={record} title="收到渠道消息" mark="C">
      <ChannelDetails record={record} />
    </ActivityFrame>
  )
}

function ChannelDeliveryCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame record={record} title="渠道投递" mark="C">
      <ChannelDetails record={record} />
    </ActivityFrame>
  )
}

function ChannelDetails({ record }: ActivityRecordCardProps): ReactNode {
  const metadata = record.metadata
  const mention = metadata.mention === null ? '未知' : metadata.mention ? '是' : '否'
  return (
    <>
      <Detail label="Adapter" value={metadata.adapter} code />
      <Detail label="会话类型" value={metadata.conversation === 'group' ? '群聊' : '私聊'} />
      <Detail label="被提及" value={mention} />
      <Detail label="Session Seq" value={metadata.seq} />
    </>
  )
}

function SkillCatalogCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame record={record} title="Skill 目录" mark="S">
      <Detail label="可见条目" value={record.metadata.count} />
      <Detail label="Session Seq" value={record.metadata.seq} />
    </ActivityFrame>
  )
}

function SkillLoadedCard({ record }: ActivityRecordCardProps): ReactNode {
  return <NamedSkillCard record={record} title="加载 Skill" />
}

function SkillInvokedCard({ record }: ActivityRecordCardProps): ReactNode {
  return <NamedSkillCard record={record} title="调用 Skill" />
}

function NamedSkillCard({ record, title }: ActivityRecordCardProps & { readonly title: string }): ReactNode {
  return (
    <ActivityFrame record={record} title={title} mark="S">
      <Detail label="Skill" value={record.metadata.skill} code />
      <Detail label="Session Seq" value={record.metadata.seq} />
    </ActivityFrame>
  )
}

function AutomationRunCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame record={record} title="Automation 运行" mark="A">
      <Detail label="规则" value={record.metadata.ruleId} code />
      <Detail label="计划时间" value={formatTimestamp(String(record.metadata.scheduledAt))} />
      <Detail label="Session Seq" value={record.metadata.seq} />
    </ActivityFrame>
  )
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date(timestamp))
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported Activity kind ${String(value)}`)
}

/** Render one fixed Activity kind without exposing a raw metadata inspector. */
export function ActivityRecordCard({ record }: ActivityRecordCardProps): ReactNode {
  switch (record.kind) {
    case 'prompt.contribution': return <PromptContributionCard record={record} />
    case 'memory.search': return <MemorySearchCard record={record} />
    case 'memory.read': return <MemoryReadCard record={record} />
    case 'memory.flush': return <MemoryFlushCard record={record} />
    case 'channel.received': return <ChannelReceivedCard record={record} />
    case 'channel.delivery': return <ChannelDeliveryCard record={record} />
    case 'skill.catalog': return <SkillCatalogCard record={record} />
    case 'skill.loaded': return <SkillLoadedCard record={record} />
    case 'skill.invoked': return <SkillInvokedCard record={record} />
    case 'automation.run': return <AutomationRunCard record={record} />
    default: return assertNever(record.kind)
  }
}
