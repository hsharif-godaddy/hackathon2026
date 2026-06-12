/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import SecretsToolRenderer from '@/app/[market]/develop/components/tool-renderers/SecretsToolRenderer'
import { SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM } from '@/config/switchboard-flags'
import { renderWithProviders } from '@/tests/test-utils'

const mockIsActivelyStreaming = vi.hoisted(() => vi.fn(() => false))
const mockUseSwitchboard = vi.hoisted(() => vi.fn((_name: string) => false))

vi.mock('@/hooks/useSwitchboard', () => ({
  getSwitchboardFlag: (name: string) => mockUseSwitchboard(name),
  useSwitchboard: (name: string) => mockUseSwitchboard(name),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mockIsActivelyStreaming(),
}))

// ChatSecretsThreadNotice was replaced by ChatSecretsRequestMessage
// No need to mock since ChatSecretsRequestMessage is the actual component we're testing

vi.mock('@/app/[market]/develop/components/ChatSecretsRequestMessage', () => ({
  default: function MockChatSecretsRequestMessage({
    isInteractive,
    payload
  }: {
    isInteractive: boolean
    payload: SecretsRequestPayload
  }) {
    return (
      <div
        data-testid="secrets-inline-form"
        data-interactive={String(isInteractive)}
        data-payload-title={payload.title}
      />
    )
  },
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer', () => ({
  default: function MockDefaultToolRenderer() {
    return <div data-testid="secrets-default-tool-renderer" />
  },
}))

function eligiblePayload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'Need key',
    description: 'From dashboard',
    secrets: [{ name: 'API_KEY', required: true }],
    mode: 'add',
    ...overrides,
  }
}

function completedSecretsResult(payload: SecretsRequestPayload) {
  return {
    success: true,
    secretsRequired: true,
    secretsRequest: payload,
  }
}

describe('SecretsToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsActivelyStreaming.mockReturnValue(false)
    mockUseSwitchboard.mockImplementation((name: string) => name === SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM)
  })

  it('returns null when payload is composer-eligible and flag is ON (takeover mode)', function returnsNullWhenFlagOn() {
    mockUseSwitchboard.mockImplementation(() => true) // Flag ON
    const payload = eligiblePayload({ title: 'Stripe' })
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    // When flag is ON, nothing renders inline (takeover shows in chat input instead)
    expect(screen.queryByTestId('secrets-inline-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secrets-default-tool-renderer')).not.toBeInTheDocument()
  })

  it('returns null for multi-secret payload when flag is ON (takeover supports paginated)', function returnsNullMultiSecretFlagOn() {
    mockUseSwitchboard.mockImplementation(() => true) // Flag ON
    const payload = eligiblePayload({
      secrets: [
        { name: 'A', required: true },
        { name: 'B', required: true },
      ],
    })
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    // Multi-secret is composer-eligible (supports paginated mode), so returns null when flag ON
    expect(screen.queryByTestId('secrets-inline-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secrets-default-tool-renderer')).not.toBeInTheDocument()
  })

  it('renders inline form for multi-secret when flag is OFF', function rendersInlineMultiSecretFlagOff() {
    mockUseSwitchboard.mockImplementation(() => false) // Flag OFF
    const payload = eligiblePayload({
      title: 'Twilio',
      secrets: [
        { name: 'ACCOUNT_SID', required: true },
        { name: 'AUTH_TOKEN', required: true },
      ],
    })
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    // When flag OFF, all secrets show inline regardless of count
    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-interactive', 'true')
    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-payload-title', 'Twilio')
  })

  it('renders inline form as non-interactive when not last assistant message', function rendersInlineNotLast() {
    mockUseSwitchboard.mockImplementation(() => false) // Flag OFF
    const payload = eligiblePayload()
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage={false}
        result={completedSecretsResult(payload)}
      />,
    )

    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-interactive', 'false')
  })

  it('renders inline form as non-interactive while streaming even if last', function rendersInlineWhileStreaming() {
    mockUseSwitchboard.mockImplementation(() => false) // Flag OFF
    mockIsActivelyStreaming.mockReturnValue(true)
    const payload = eligiblePayload()
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-interactive', 'false')
  })

  it('renders inline form with interactive=true when flag OFF and is last message', function rendersInlineFlagOff() {
    mockUseSwitchboard.mockImplementation(() => false) // Flag OFF
    const payload = eligiblePayload({ title: 'Stripe' })
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-interactive', 'true')
    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-payload-title', 'Stripe')
  })

  it('renders inline form when composer-eligible but secrets-form flag is off', function rendersInlineWhenFlagOff() {
    mockUseSwitchboard.mockImplementation(() => false)
    const payload = eligiblePayload({ title: 'Legacy path' })
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={completedSecretsResult(payload)}
      />,
    )

    expect(screen.getByTestId('secrets-inline-form')).toHaveAttribute('data-interactive', 'true')
    expect(screen.queryByTestId('secrets-thread-notice')).not.toBeInTheDocument()
  })

  it('delegates to default renderer when secrets payload is malformed', function malformedPayload() {
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={{
          secretsRequired: true,
          secretsRequest: {
            title: 'T',
            description: 'D',
            secrets: [{ name: 1 }],
            mode: 'add',
          },
        }}
      />,
    )

    expect(screen.getByTestId('secrets-default-tool-renderer')).toBeInTheDocument()
    expect(screen.queryByTestId('secrets-inline-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secrets-thread-notice')).not.toBeInTheDocument()
  })

  it('returns null when success without secrets required', function rendersNullWhenNoSecrets() {
    renderWithProviders(
      <SecretsToolRenderer
        toolName="requestSecrets"
        toolStatus="completed"
        isLastAssistantMessage
        result={{ success: true, secretsRequired: false }}
      />,
    )

    expect(screen.queryByTestId('secrets-thread-notice')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secrets-inline-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('secrets-default-tool-renderer')).not.toBeInTheDocument()
  })

  it('delegates to default renderer when tool is not completed', function delegatesRunning() {
    renderWithProviders(
      <SecretsToolRenderer toolName="requestSecrets" toolStatus="running" result={undefined} />,
    )

    expect(screen.getByTestId('secrets-default-tool-renderer')).toBeInTheDocument()
  })
})
