import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createClawdshContextMessageNodeView } from '../src/channel-message-view.tsx'

afterEach(cleanup)

function contextNode(source: unknown) {
  return {
    key: 'input-message:1',
    kind: 'context',
    id: 'message-1',
    target: 'chat',
    anchorSeq: 1,
    location: { turn: 1, step: 1 },
    visibility: 'visible',
    data: {
      kind: 'context',
      seq: 1,
      time: 1,
      content: [{ type: 'text', text: '飞书入站消息' }],
      source,
      provenance: { role: 'injection', label: 'channel' },
      form: null,
    },
  }
}

describe('ClawDSH Channel message projection', () => {
  it('renders admitted Channel input as an ordinary user bubble', () => {
    function StandardContextView() { return <div>standard context</div> }
    function StandardUserView({ node }: ChatNodeViewProps<'user' | 'steering'>) {
      return <div data-renderer={node.kind}>{node.data.content[0]?.type === 'text' ? node.data.content[0].text : ''}</div>
    }
    const View = createClawdshContextMessageNodeView({ context: StandardContextView, user: StandardUserView })
    const { container } = render(<View {...({
      node: contextNode({ kind: 'channel', channel: 'feishu' }),
      loadImage: vi.fn(),
      t: vi.fn((key: string) => key),
      openFile: vi.fn(),
      inspectCall: vi.fn(),
      forkAt: vi.fn(),
      fileMentions: vi.fn(),
    } as unknown as ChatNodeViewProps<'context'>)} />)

    expect(screen.getByText('飞书入站消息')).toBeTruthy()
    expect(container.querySelector('[data-renderer="user"]')).not.toBeNull()
  })

  it('keeps non-Channel context in the standard context renderer', () => {
    function StandardContextView() { return <div>standard context</div> }
    function StandardUserView() { return <div>standard user</div> }
    const View = createClawdshContextMessageNodeView({ context: StandardContextView, user: StandardUserView })
    render(<View {...({
      node: contextNode({ kind: 'plugin', plugin: 'instructions' }),
    } as unknown as ChatNodeViewProps<'context'>)} />)

    expect(screen.getByText('standard context')).toBeTruthy()
  })
})
