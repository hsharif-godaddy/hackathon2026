/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import ChatSecretsThreadNotice from '@/app/[market]/develop/components/chat/ChatSecretsThreadNotice'
import type { SecretsRequestPayload } from '@/app/[market]/develop/components/ChatSecretsRequestMessage'
import { renderWithProviders } from '@/tests/test-utils'

function basePayload(overrides: Partial<SecretsRequestPayload> = {}): SecretsRequestPayload {
  return {
    type: 'secrets_request',
    title: 'Need a key',
    description: 'From the provider dashboard.',
    secrets: [{ name: 'API_KEY', required: true }],
    mode: 'add',
    ...overrides,
  }
}

describe('ChatSecretsThreadNotice', () => {
  it('shows settings footer when showSettingsLink is true', () => {
    renderWithProviders(
      <ChatSecretsThreadNotice
        isInteractive
        payload={basePayload({ showSettingsLink: true })}
      />,
    )

    expect(
      screen.getByText('You can also manage this from secrets settings'),
    ).toBeInTheDocument()
  })

  it('shows inactive composer hint when not interactive', () => {
    renderWithProviders(
      <ChatSecretsThreadNotice isInteractive={false} payload={basePayload()} />,
    )

    expect(
      screen.getByText(
        'If you still need this credential, use the secret form at the bottom of the chat when it is shown, or ask here to be prompted again.',
      ),
    ).toBeInTheDocument()
  })

  it('does not show inactive hint when interactive', () => {
    renderWithProviders(
      <ChatSecretsThreadNotice isInteractive payload={basePayload()} />,
    )

    expect(
      screen.queryByText(
        'If you still need this credential, use the secret form at the bottom of the chat when it is shown, or ask here to be prompted again.',
      ),
    ).not.toBeInTheDocument()
  })
})
