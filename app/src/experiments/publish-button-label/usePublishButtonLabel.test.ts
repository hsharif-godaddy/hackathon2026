/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { PublishButtonLabelCohort, usePublishButtonLabel } from './usePublishButtonLabel'

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({ get: () => null })),
}))

vi.mock('@/hooks/useHivemind', () => ({
  useHivemind: vi.fn(() => ({ cohort: PublishButtonLabelCohort.CONTROL, data: undefined, experiment: undefined })),
}))

async function setMocks(opts: {
  cohort?: string | undefined
  qaOverride?: string | null
}): Promise<void> {
  const nav = await import('next/navigation')
  const hive = await import('@/hooks/useHivemind')
  vi.mocked(nav.useSearchParams).mockReturnValue({ get: () => opts.qaOverride ?? null } as unknown as ReturnType<typeof nav.useSearchParams>)
  vi.mocked(hive.useHivemind).mockReturnValue({ cohort: opts.cohort, data: undefined, experiment: undefined })
}

describe('usePublishButtonLabel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('first publish (never published before)', () => {
    it('control cohort returns builder_publish_button', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.CONTROL })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button')
    })

    it('go-live cohort returns builder_publish_button_go_live', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.GO_LIVE })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button_go_live')
    })

    it('launch cohort returns builder_publish_button_launch', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.LAUNCH })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button_launch')
    })
  })

  describe('already published', () => {
    it('control cohort returns builder_publish_button', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.CONTROL })
      const { result } = renderHook(() => usePublishButtonLabel(false))
      expect(result.current).toBe('builder_publish_button')
    })

    it('go-live cohort returns builder_publish_button_apply_update', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.GO_LIVE })
      const { result } = renderHook(() => usePublishButtonLabel(false))
      expect(result.current).toBe('builder_publish_button_apply_update')
    })

    it('launch cohort returns builder_publish_button_apply_update', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.LAUNCH })
      const { result } = renderHook(() => usePublishButtonLabel(false))
      expect(result.current).toBe('builder_publish_button_apply_update')
    })
  })

  describe('experiment inactive / not bucketed', () => {
    it('undefined cohort (user not bucketed) falls back to control label', async () => {
      await setMocks({ cohort: undefined })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button')
    })

    it('unrecognized cohort string falls back to control label', async () => {
      await setMocks({ cohort: 'ineligible' })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button')
    })
  })

  describe('QA override via ?publishButtonLabel search param', () => {
    it('override takes precedence over the Hivemind cohort', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.CONTROL, qaOverride: 'go-live' })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button_go_live')
    })

    it('override applies the already-published label table when isFirstPublish is false', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.CONTROL, qaOverride: 'go-live' })
      const { result } = renderHook(() => usePublishButtonLabel(false))
      expect(result.current).toBe('builder_publish_button_apply_update')
    })

    it('unrecognized override value falls back to control label', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.GO_LIVE, qaOverride: 'GO_LIVE' })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button')
    })

    it('null override (param absent) defers to the experiment cohort', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.LAUNCH, qaOverride: null })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button_launch')
    })

    it('empty-string override (?publishButtonLabel=) defers to the experiment cohort', async () => {
      await setMocks({ cohort: PublishButtonLabelCohort.LAUNCH, qaOverride: '' })
      const { result } = renderHook(() => usePublishButtonLabel(true))
      expect(result.current).toBe('builder_publish_button_launch')
    })
  })
})
