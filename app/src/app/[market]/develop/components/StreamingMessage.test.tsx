/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import type { ChatMessage } from '@/stores/useStreamingConversationStore'

const mockSwitchboardFlags: Record<string, boolean | undefined> = {}

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (key: string) => mockSwitchboardFlags[key] ?? false,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingState: () => 'idle',
}))

const getToolRendererSpy = vi.fn<(toolName: string) => ComponentType<Record<string, unknown>>>()

vi.mock('./tool-renderers', () => ({
  getToolRenderer: (toolName: string) => getToolRendererSpy(toolName),
}))

// Avoid rendering the full streaming tree — user-action branch returns before
// this path is used.
vi.mock('./StreamingIntegratedResponse', () => ({
  default: () => null,
}))

import StreamingMessage from './StreamingMessage'

function makeUserActionMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'notice-1',
    role: 'user',
    content: '[system] The user performed a rollback.',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    metadata: {
      kind: 'restore',
      commitHash: 'abc1234',
    },
    ...overrides,
  } as ChatMessage
}

describe('StreamingMessage — user-action branch', function streamingMessageUserActionTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks()
    // Default renderer stub — returns a distinguishable element per toolName.
    getToolRendererSpy.mockImplementation(function (toolName: string) {
      const Stub: ComponentType<Record<string, unknown>> = (props) => (
        <div data-testid={`tool-renderer-${toolName}`} data-result={JSON.stringify(props.result)} />
      )
      return Stub
    })
  })

  // The restore branch is unified: there's a single `restore` tool renderer
  // for both undo (no `restoredCommitHash`) and per-prompt restore (with one).
  // The renderer reads `restoredCommitHash` off the result to choose its own
  // header, so the StreamingMessage layer just hands the metadata through.

  it('routes restore notices to the `restore` tool renderer with hashes intact', function passesHashesThrough() {
    const { getByTestId } = render(
      <StreamingMessage message={makeUserActionMessage()} />
    )

    expect(getToolRendererSpy).toHaveBeenCalledWith('restore')
    const stub = getByTestId('tool-renderer-restore')
    const result = JSON.parse(stub.getAttribute('data-result') ?? '{}')
    expect(result).toMatchObject({
      commitHash: 'abc1234',
      stashHash: null,
      restoredCommitHash: null,
    })
  })

  it('forwards restoredCommitHash for per-prompt restore notices', function forwardsRestoredCommit() {
    const message = makeUserActionMessage({
      metadata: {
        kind: 'restore',
        commitHash: 'deadbee',
        restoredCommitHash: 'deadbee',
      },
    } as unknown as Partial<ChatMessage>)

    const { getByTestId } = render(<StreamingMessage message={message} />)

    expect(getToolRendererSpy).toHaveBeenCalledWith('restore')
    const stub = getByTestId('tool-renderer-restore')
    const result = JSON.parse(stub.getAttribute('data-result') ?? '{}')
    expect(result).toMatchObject({
      commitHash: 'deadbee',
      restoredCommitHash: 'deadbee',
    })
  })

  it('does not render a user-action card when metadata.kind is wrong', function wrongKindFallsThrough() {
    const message = makeUserActionMessage({
      metadata: { kind: 'not-a-restore', commitHash: 'abc1234' },
    } as unknown as Partial<ChatMessage>)

    const { queryByTestId } = render(<StreamingMessage message={message} />)

    expect(queryByTestId('tool-renderer-restore')).toBeNull()
  })

  it('passes a null commitHash through when metadata carries null', function nullHashPassesThrough() {
    const message = makeUserActionMessage({
      metadata: { kind: 'restore', commitHash: null },
    } as unknown as Partial<ChatMessage>)

    const { getByTestId } = render(<StreamingMessage message={message} />)

    const stub = getByTestId('tool-renderer-restore')
    const result = JSON.parse(stub.getAttribute('data-result') ?? '{}')
    expect(result.commitHash).toBeNull()
  })
})

