/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import Growl from '@ux/growl'

import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'
import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { logger } from '@/lib/request-context'
import { renderWithProviders } from '@/tests/test-utils'
import SecretsComposerSurface from './SecretsComposerSurface'

const { mockSendMessage, mockMutateAsync, mockResolveSecretsComposerToolCall, mockCancelSecretsComposerToolCall } =
  vi.hoisted(() => ({
    mockSendMessage: vi.fn(),
    mockMutateAsync: vi.fn(),
    mockResolveSecretsComposerToolCall: vi.fn(),
    mockCancelSecretsComposerToolCall: vi.fn(),
  }))

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}))

vi.mock('@airo-ux/pattern-library/input/secrets-form', () => ({
  SecretsForm: function MockSecretsForm(props: {
    onSubmit?: (value: string) => void | Promise<void>
    onClose?: () => void
  }) {
    return (
      <div>
        <button
          type="button"
          data-testid="mock-secrets-submit"
          onClick={async function mockSubmitClick() {
            try {
              await props.onSubmit?.('my-secret')
            } catch {
              // SecretsForm keeps the field open when onSubmit throws
            }
          }}
        >
          submit
        </button>
        <button
          type="button"
          data-testid="mock-secrets-submit-empty"
          onClick={async function mockSubmitEmpty() {
            try {
              await props.onSubmit?.('   ')
            } catch {
              // SecretsForm keeps the field open when onSubmit throws
            }
          }}
        >
          submit empty
        </button>
        <button type="button" data-testid="mock-secrets-close" onClick={() => props.onClose?.()}>
          close
        </button>
      </div>
    )
  },
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useCurrentAppId: () => 'app-123',
  useStreamingState: () => 'idle',
  useStreamingConversationStore: (
    selector: (s: {
      resolveSecretsComposerToolCall: typeof mockResolveSecretsComposerToolCall
      cancelSecretsComposerToolCall: typeof mockCancelSecretsComposerToolCall
    }) => unknown,
  ) =>
    selector({
      resolveSecretsComposerToolCall: mockResolveSecretsComposerToolCall,
      cancelSecretsComposerToolCall: mockCancelSecretsComposerToolCall,
    }),
}))

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: mockSendMessage,
  }),
}))

vi.mock('@/hooks/useSecretOperations', () => ({
  useSecretOperations: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function eligiblePayload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'API key',
    description: 'Paste your key.',
    secrets: [{ name: 'OPENAI_API_KEY', required: true }],
    mode: 'add',
    ...overrides,
  }
}

function activeRequest(
  toolCallId: string,
  overrides: Partial<SecretsRequestPayload> = {},
): ActiveSecretsRequest {
  const payload = eligiblePayload(overrides)
  const secretName = payload.secrets[0].name
  return {
    payload,
    toolCallId,
    secretKey: `${toolCallId}:${secretName}`,
    allSecretNames: payload.secrets.map((secret) => secret.name),
    displayMode: 'single',
    stepIndex: 1,
    stepTotal: 1,
  }
}

describe('SecretsComposerSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue(undefined)
  })

  it('calls mutate and sendMessage with continuation on submit for add', async () => {
    const { user } = renderWithProviders(
      <SecretsComposerSurface request={activeRequest('tc-1')} />,
    )

    await user.click(screen.getByTestId('mock-secrets-submit'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'app-123',
        variant: 'preview',
        operations: {
          additions: [{ name: 'OPENAI_API_KEY', value: 'my-secret' }],
          updates: undefined,
        },
      })
    })

    await waitFor(() => {
      expect(mockResolveSecretsComposerToolCall).toHaveBeenCalledWith('tc-1:OPENAI_API_KEY')
    })

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        content: '[[secrets-composer-outcome:added]] Secret added successfully: OPENAI_API_KEY',
      })
    })
  })

  it('uses updates when secret is existing', async () => {
    const request = activeRequest('tc-2', {
      mode: 'update',
      secrets: [{ name: 'STRIPE_KEY', required: true, isExisting: true }],
    })
    const { user } = renderWithProviders(<SecretsComposerSurface request={request} />)

    await user.click(screen.getByTestId('mock-secrets-submit'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'app-123',
        variant: 'preview',
        operations: {
          additions: undefined,
          updates: [{ name: 'STRIPE_KEY', value: 'my-secret' }],
        },
      })
    })

    await waitFor(() => {
      expect(mockResolveSecretsComposerToolCall).toHaveBeenCalledWith('tc-2:STRIPE_KEY')
    })

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        content: '[[secrets-composer-outcome:updated]] Secret updated successfully: STRIPE_KEY',
      })
    })
  })

  it('does not call mutate when submit value is empty', async function submitEmpty() {
    const { user } = renderWithProviders(
      <SecretsComposerSurface request={activeRequest('tc-empty')} />,
    )

    await user.click(screen.getByTestId('mock-secrets-submit-empty'))

    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(mockResolveSecretsComposerToolCall).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('logs error, shows growl, and does not resolve on mutate failure', async function mutateFailure() {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error'))

    const { user } = renderWithProviders(
      <SecretsComposerSurface request={activeRequest('tc-fail')} />,
    )

    await user.click(screen.getByTestId('mock-secrets-submit'))

    await waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith('secrets.panel.error', {
        conversationId: undefined,
        appId: 'app-123',
        toolCallId: 'tc-fail',
        error: 'Network error',
      })
    })

    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'secrets-panel-error-tc-fail',
        title: 'builder_status_failed',
        children: 'Network error',
        emphasis: 'critical',
      }),
    )
    expect(mockResolveSecretsComposerToolCall).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('cancels the tool call on close', async () => {
    const { user } = renderWithProviders(
      <SecretsComposerSurface request={activeRequest('tc-3')} />,
    )

    await user.click(screen.getByTestId('mock-secrets-close'))

    expect(mockCancelSecretsComposerToolCall).toHaveBeenCalledWith('tc-3', ['OPENAI_API_KEY'])

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        content: '[[secrets-composer-outcome:cancel]]',
      })
    })
  })
})
