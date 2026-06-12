/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useInputActionsPanelEnabled } from '@/app/[market]/develop/components/chat/useInputActionsPanelEnabled'
import { SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM } from '@/config/switchboard-flags'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

import { useSwitchboard } from '@/hooks/useSwitchboard'

describe('useInputActionsPanelEnabled', () => {
  it('returns true when only the secrets form flag is on', () => {
    vi.mocked(useSwitchboard).mockImplementation((name: string) =>
      name === SWITCHBOARD_AIRO_BUILDER_SECRETS_FORM,
    )

    const { result } = renderHook(() => useInputActionsPanelEnabled())
    expect(result.current).toBe(true)
  })

  it('returns false when no related flags are on', () => {
    vi.mocked(useSwitchboard).mockReturnValue(false)

    const { result } = renderHook(() => useInputActionsPanelEnabled())
    expect(result.current).toBe(false)
  })
})
