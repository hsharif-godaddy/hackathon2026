/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { handlePreviewRefresh } from '@/app/[market]/develop/components/utils'
import { renderWithProviders } from '@/tests/test-utils'
import CommerceInstallStorefrontToolRenderer from './CommerceInstallStorefrontToolRenderer'

vi.mock('@/app/[market]/develop/components/utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/[market]/develop/components/utils')>('@/app/[market]/develop/components/utils')
  return {
    ...actual,
    handlePreviewRefresh: vi.fn(),
  }
})

describe('CommerceInstallStorefrontToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes the preview once after a successful storefront install restart', async () => {
    const { rerender } = renderWithProviders(
      <CommerceInstallStorefrontToolRenderer
        toolId="tool-1"
        toolName="commerce__install_storefront"
        toolStatus="completed"
        result={{ serverRestarted: true, envVarsWritten: ['VITE_GODADDY_CLIENT_ID'] }}
        isLastAssistantMessage
      />
    )

    await waitFor(() => {
      expect(vi.mocked(handlePreviewRefresh)).toHaveBeenCalledTimes(1)
    })

    rerender(
      <CommerceInstallStorefrontToolRenderer
        toolId="tool-1"
        toolName="commerce__install_storefront"
        toolStatus="completed"
        result={{ serverRestarted: true, envVarsWritten: ['VITE_GODADDY_CLIENT_ID'] }}
        isLastAssistantMessage
      />
    )

    await waitFor(() => {
      expect(vi.mocked(handlePreviewRefresh)).toHaveBeenCalledTimes(1)
    })
  })

  it('parses stringified results before deciding to refresh', async () => {
    renderWithProviders(
      <CommerceInstallStorefrontToolRenderer
        toolId="tool-string"
        toolName="commerce__install_storefront"
        toolStatus="completed"
        result={JSON.stringify({ serverRestarted: true })}
        isLastAssistantMessage
      />
    )

    await waitFor(() => {
      expect(vi.mocked(handlePreviewRefresh)).toHaveBeenCalledTimes(1)
    })
  })

  it('does not refresh the preview for history entries', async () => {
    renderWithProviders(
      <CommerceInstallStorefrontToolRenderer
        toolId="tool-2"
        toolName="commerce__install_storefront"
        toolStatus="completed"
        result={{ serverRestarted: true }}
        isLastAssistantMessage={false}
      />
    )

    await Promise.resolve()

    expect(vi.mocked(handlePreviewRefresh)).not.toHaveBeenCalled()
  })

  it('does not refresh when the install did not restart the server', async () => {
    renderWithProviders(
      <CommerceInstallStorefrontToolRenderer
        toolId="tool-3"
        toolName="commerce__install_storefront"
        toolStatus="completed"
        result={{ serverRestarted: false }}
        isLastAssistantMessage
      />
    )

    await Promise.resolve()

    expect(vi.mocked(handlePreviewRefresh)).not.toHaveBeenCalled()
  })
})
