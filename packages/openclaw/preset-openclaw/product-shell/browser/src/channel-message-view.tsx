import type { ComponentType } from 'react'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

function isChannelSource(source: unknown): boolean {
  return source !== null
    && typeof source === 'object'
    && !Array.isArray(source)
    && (source as { kind?: unknown }).kind === 'channel'
}

/** Standard Chat renderers captured before the product-level context cell is shadowed. */
export interface StandardMessageViews {
  readonly context: ComponentType<ChatNodeViewProps<'context'>>
  readonly user: ComponentType<ChatNodeViewProps<'user' | 'steering'>>
}

/** Build a renderer that presents admitted Channel input as a human message. */
export function createClawdshContextMessageNodeView(views: StandardMessageViews) {
  const StandardContextView = views.context
  const StandardUserView = views.user
  return function ClawdshContextMessageNodeView(props: ChatNodeViewProps<'context'>) {
    const { node } = props
    if (!isChannelSource(node.data.source)) return <StandardContextView {...props} />
    const data: UserMessageNode = {
      kind: 'user',
      seq: node.data.seq,
      time: node.data.time,
      content: node.data.content,
      source: node.data.source,
    }
    const userNode: ChatNode<'user'> = { ...node, kind: 'user', data }
    return <StandardUserView {...props} node={userNode} />
  }
}
