import type { ReactNode } from 'react'
import type {
  ClawdshActivityCategory,
  ClawdshActivityRecord,
  ClawdshActivityStatus,
} from '../../../shared/src/protocol.ts'
import type { ActivityContextItem, ActivityPresentationItem } from './activity-presentation.ts'
import css from './ActivityPage.module.css'

interface ActivityItemCardProps {
  readonly item: ActivityPresentationItem
}

interface ActivityRecordCardProps {
  readonly record: ClawdshActivityRecord
}

interface ActivityFrameProps {
  readonly category: ClawdshActivityCategory
  readonly kind: string
  readonly title: string
  readonly mark: string
  readonly timestamp: string
  readonly seq: number
  readonly status?: ClawdshActivityStatus | undefined
  readonly children?: ReactNode
  readonly technical: ReactNode
}

const CATEGORY_LABEL: Readonly<Record<ClawdshActivityCategory, string>> = {
  prompt: '身份与上下文',
  memory: '记忆',
  channel: '外部消息',
  skill: '技能',
  automation: '定时任务',
}

const STATUS_LABEL: Readonly<Record<ClawdshActivityStatus, string>> = {
  started: '未记录完成结果',
  succeeded: '已完成',
  failed: '失败',
  sent: '已发送',
}

function ActivityFrame({
  category,
  kind,
  title,
  mark,
  timestamp,
  seq,
  status,
  children,
  technical,
}: ActivityFrameProps): ReactNode {
  return (
    <article className={css.record} data-category={category} data-kind={kind} data-status={status}>
      <div className={css.recordMark} aria-hidden="true">{mark}</div>
      <div className={css.recordBody}>
        <header className={css.recordHeader}>
          <div>
            <span className={css.category}>{CATEGORY_LABEL[category]}</span>
            <h3>{title}</h3>
          </div>
          <div className={css.recordState}>
            {status === undefined ? null : (
              <span className={css.status} data-status={status}>{STATUS_LABEL[status]}</span>
            )}
            <time dateTime={timestamp}>{formatTimestamp(timestamp)}</time>
          </div>
        </header>
        {children}
        <details className={css.technical}>
          <summary aria-label={`${title}，会话事件序号 ${String(seq)}，技术详情`}>技术详情</summary>
          {technical}
        </details>
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

function BaseTechnicalDetails({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <dl className={css.metadata}>
      <Detail label="事件类型" value={record.kind} code />
      <Detail label="会话事件序号" value={record.metadata.seq ?? '未知'} />
      {record.status === undefined ? null : <Detail label="状态" value={STATUS_LABEL[record.status]} />}
    </dl>
  )
}

function ContextPreparationCard({ item }: { readonly item: ActivityContextItem }): ReactNode {
  const soul = item.records.find(record => record.metadata.producer === 'soul')
  const memory = item.records.find(record => record.metadata.producer === 'memory')
  return (
    <ActivityFrame
      category="prompt"
      kind="prompt.contribution"
      title="已准备本轮 ClawDSH 上下文"
      mark="◎"
      timestamp={item.timestamp}
      seq={item.seq}
      technical={(
        <div className={css.contributionDetails}>
          {item.records.map(record => (
            <dl key={record.id} className={css.metadata}>
              <Detail label="来源" value={record.metadata.producer === 'soul' ? '助手身份' : '记忆使用说明'} />
              <Detail label="区段" value={record.metadata.section} code />
              <Detail label="方式" value={record.metadata.mode === 'replace' ? '替换' : '追加'} />
              <Detail label="字符数" value={record.metadata.characters} />
              <Detail label="SHA-256" value={record.metadata.sha256} code />
              <Detail label="会话事件序号" value={record.metadata.seq} />
            </dl>
          ))}
        </div>
      )}
    >
      <ul className={css.contextSummary}>
        {soul === undefined ? null : <li>已应用 ClawDSH 助手身份。</li>}
        {memory === undefined ? null : (
          <li>已向 Agent 提供记忆使用说明；这不代表已读取或写入记忆。</li>
        )}
      </ul>
    </ActivityFrame>
  )
}

function WorkCard({ record, title, mark, description }: ActivityRecordCardProps & {
  readonly title: string
  readonly mark: string
  readonly description: string
}): ReactNode {
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title={record.status === 'failed' ? `${title}失败` : title}
      mark={mark}
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      status={record.status}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <p className={css.recordDescription}>{description}</p>
    </ActivityFrame>
  )
}

function MemorySearchCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <WorkCard
      record={record}
      title="搜索长期记忆"
      mark="记"
      description={record.status === 'failed'
        ? 'Agent 未能完成这次长期记忆搜索；记录不包含查询、结果或错误正文。'
        : record.status === 'started'
          ? '记录到搜索操作已开始，但没有记录到完成结果。'
          : 'Agent 已完成一次长期记忆搜索；记录不包含查询或搜索结果。'}
    />
  )
}

function MemoryReadCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <WorkCard
      record={record}
      title="读取长期记忆"
      mark="记"
      description={record.status === 'failed'
        ? 'Agent 未能读取所需的长期记忆；记录不包含文件名、内容或错误正文。'
        : record.status === 'started'
          ? '记录到读取操作已开始，但没有记录到完成结果。'
          : 'Agent 已读取长期记忆；记录不会展示文件名或内容。'}
    />
  )
}

function MemoryWriteCard({ record }: ActivityRecordCardProps): ReactNode {
  const scope = record.metadata.scope === 'durable' ? '长期事实' : '当日记录'
  const outcome = record.metadata.outcome
  const title = outcome === 'already-stored'
    ? '长期事实已存在'
    : outcome === 'stored'
      ? `写入${scope}`
      : `保存${scope}`
  const description = record.status === 'failed'
    ? `Agent 未能保存${scope}；记录不会展示内容、路径或错误正文。`
    : record.status === 'started'
      ? `记录到保存${scope}的操作已开始，但没有记录到完成结果。`
      : outcome === 'already-stored'
        ? '这条长期事实已经存在，因此没有重复写入；记录不会展示事实内容或路径。'
        : outcome === 'stored'
          ? `Agent 已写入${scope}；记录不会展示内容或路径。`
          : `这次保存${scope}的请求已完成；旧记录没有区分实际写入与内容已存在。`
  return (
    <WorkCard
      record={record}
      title={title}
      mark="记"
      description={description}
    />
  )
}

function MemoryUpdateCard({ record }: ActivityRecordCardProps): ReactNode {
  const forgotten = record.metadata.action === 'forgotten'
  const action = forgotten ? '删除' : '更新'
  const outcome = record.metadata.outcome
  const title = outcome === 'already-current'
    ? '长期记忆无需更新'
    : outcome === 'not-found'
      ? `未找到要${action}的长期记忆`
      : `${action}长期记忆`
  const description = record.status === 'failed'
    ? `Agent 未能${action}这条长期记忆；记录不会展示原内容、新内容或错误正文。`
    : record.status === 'started'
      ? `记录到${action}长期记忆的操作已开始，但没有记录到完成结果。`
      : outcome === 'updated'
        ? 'Agent 已更新长期记忆；记录不会展示原内容或新内容。'
        : outcome === 'forgotten'
          ? 'Agent 已删除长期记忆；记录不会展示被删除的内容。'
          : outcome === 'already-current'
            ? '长期记忆已经是目标内容，因此没有修改。'
            : outcome === 'not-found'
              ? `没有找到完全匹配的长期记忆，因此没有${action}任何内容。`
              : `这次${action}请求已完成；旧记录没有区分是否实际修改了长期记忆。`
  return (
    <WorkCard
      record={record}
      title={title}
      mark="记"
      description={description}
    />
  )
}

function MemoryFlushCard({ record }: ActivityRecordCardProps): ReactNode {
  const description = record.status === 'failed'
    ? 'Agent 未能处理这次记忆整理请求；记录不包含整理提示、回复或错误正文。'
    : record.status === 'started'
      ? '已向 Agent 发出记忆整理请求，但没有记录到完成结果；这不代表记忆已经写入。'
      : 'Agent 已处理记忆整理请求；这仍不代表一定写入了新的记忆。'
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title={record.status === 'failed' ? '记忆整理请求失败' : '发起记忆整理'}
      mark="记"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      status={record.status}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <p className={css.recordDescription}>{description}</p>
    </ActivityFrame>
  )
}

function ChannelReceivedCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title="收到外部消息"
      mark="信"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <dl className={css.metadata}>
        <Detail label="平台" value={record.metadata.adapter} />
        <Detail label="会话类型" value={record.metadata.conversation === 'group' ? '群聊' : '私聊'} />
        {record.metadata.mention === null ? null : (
          <Detail label="提及助手" value={record.metadata.mention ? '是' : '否'} />
        )}
      </dl>
    </ActivityFrame>
  )
}

function ChannelDeliveryCard({ record }: ActivityRecordCardProps): ReactNode {
  const title = record.status === 'failed'
    ? '发送外部消息失败'
    : record.status === 'sent'
      ? '已发送外部消息'
      : record.status === 'started'
        ? '外部消息发送结果未知'
        : '记录到外部消息发送请求'
  const description = record.status === 'failed'
    ? '消息未能发送；记录不会展示消息正文、收件人或错误正文。'
    : record.status === 'sent'
      ? '平台已确认发送；记录不会展示消息正文或收件人。'
      : record.status === 'started'
        ? '记录到发送操作已开始，但没有记录到平台确认结果。'
        : '旧记录没有保存可确认的发送结果。'
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title={title}
      mark="信"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      status={record.status}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <dl className={css.metadata}>
        <Detail label="平台" value={record.metadata.adapter} />
        <Detail label="会话类型" value={record.metadata.conversation === 'group' ? '群聊' : '私聊'} />
      </dl>
      <p className={css.recordDescription}>{description}</p>
    </ActivityFrame>
  )
}

function SkillCatalogCard({ record }: ActivityRecordCardProps): ReactNode {
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title="已准备可用技能目录"
      mark="技"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <p className={css.recordDescription}>本轮向 Agent 提供了 {record.metadata.count} 项可选技能；这不代表调用了技能。</p>
    </ActivityFrame>
  )
}

function NamedSkillCard({ record, invoked }: ActivityRecordCardProps & { readonly invoked: boolean }): ReactNode {
  const skill = String(record.metadata.skill)
  const description = invoked
    ? record.status === 'failed'
      ? 'Agent 未能完成这次技能调用；记录不会展示调用参数、结果或错误正文。'
      : record.status === 'started'
        ? '记录到技能调用已开始，但没有记录到完成结果。'
        : 'Agent 已完成这次技能调用；记录不会展示调用参数或结果。'
    : '已向 Agent 提供这项技能的使用说明；载入说明不等于已经调用技能。'
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title={invoked
        ? record.status === 'failed' ? `调用 ${skill} 技能失败` : `调用 ${skill} 技能`
        : `已载入 ${skill} 技能说明`}
      mark="技"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      status={record.status}
      technical={<BaseTechnicalDetails record={record} />}
    >
      <p className={css.recordDescription}>{description}</p>
    </ActivityFrame>
  )
}

function AutomationRunCard({ record }: ActivityRecordCardProps): ReactNode {
  const description = record.status === 'failed'
    ? '这次定时任务没有成功完成；记录不会展示任务指令、回复或错误正文。'
    : record.status === 'started'
      ? '记录到定时任务已开始，但没有记录到完成结果。'
      : '这次定时任务已完成；结果保存在该任务自己的对话中。'
  return (
    <ActivityFrame
      category={record.category}
      kind={record.kind}
      title={record.status === 'failed' ? '定时任务运行失败' : '运行定时任务'}
      mark="时"
      timestamp={record.timestamp}
      seq={Number(record.metadata.seq)}
      status={record.status}
      technical={(
        <>
          <BaseTechnicalDetails record={record} />
          <dl className={css.metadata}>
            <Detail label="规则标识" value={record.metadata.ruleId} code />
          </dl>
        </>
      )}
    >
      <dl className={css.metadata}>
        <Detail label="计划时间" value={formatTimestamp(String(record.metadata.scheduledAt))} />
      </dl>
      <p className={css.recordDescription}>{description}</p>
    </ActivityFrame>
  )
}

function PromptContributionCard({ record }: ActivityRecordCardProps): ReactNode {
  return <ContextPreparationCard item={{
    type: 'context',
    id: `context:${record.id}`,
    timestamp: record.timestamp,
    seq: Number(record.metadata.seq),
    records: [record],
  }} />
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

/**
 * Render one user-facing Activity item with privacy-safe technical details folded away.
 * @param props - Pure presentation item derived from strict Activity records.
 * @returns The context summary or kind-specific record card.
 */
export function ActivityItemCard({ item }: ActivityItemCardProps): ReactNode {
  if (item.type === 'context') return <ContextPreparationCard item={item} />
  const { record } = item
  switch (record.kind) {
    case 'prompt.contribution': return <PromptContributionCard record={record} />
    case 'memory.search': return <MemorySearchCard record={record} />
    case 'memory.read': return <MemoryReadCard record={record} />
    case 'memory.write': return <MemoryWriteCard record={record} />
    case 'memory.update': return <MemoryUpdateCard record={record} />
    case 'memory.flush': return <MemoryFlushCard record={record} />
    case 'channel.received': return <ChannelReceivedCard record={record} />
    case 'channel.delivery': return <ChannelDeliveryCard record={record} />
    case 'skill.catalog': return <SkillCatalogCard record={record} />
    case 'skill.loaded': return <NamedSkillCard record={record} invoked={false} />
    case 'skill.invoked': return <NamedSkillCard record={record} invoked />
    case 'automation.run': return <AutomationRunCard record={record} />
    default: return assertNever(record.kind)
  }
}
