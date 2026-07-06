/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BUILDER_LAYOUT, DESIGN_KIT_BUILD_CANVAS_ID } from '@airo/shared'

import { useWizardStore } from '@/stores/useWizardStore'
import { handleBuilderLayoutNotification } from './builderLayoutNotification'

const APP_ID = 'app-123'

describe('handleBuilderLayoutNotification', () => {
  beforeEach(() => {
    useWizardStore.setState({ builderLayoutByApp: {} })
  })

  it('writes the normalized descriptor to the store for the matching app', () => {
    handleBuilderLayoutNotification({
      raw: {
        appId: APP_ID,
        builderLayout: {
          version: 1,
          layout: 'immersive',
          pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
        },
      },
      clientAppId: APP_ID,
      logPrefix: 'sse.builder_layout',
    })

    expect(useWizardStore.getState().builderLayoutByApp[APP_ID]).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
    })
  })

  it('normalizes an illegal descriptor to the default builder layout', () => {
    handleBuilderLayoutNotification({
      raw: { appId: APP_ID, builderLayout: { version: 99, layout: 'nonsense' } },
      clientAppId: APP_ID,
      logPrefix: 'sse.builder_layout',
    })

    expect(useWizardStore.getState().builderLayoutByApp[APP_ID]).toEqual(DEFAULT_BUILDER_LAYOUT)
  })

  it('ignores an event scoped to a different app', () => {
    handleBuilderLayoutNotification({
      raw: { appId: 'other-app', builderLayout: { version: 1, layout: 'immersive' } },
      clientAppId: APP_ID,
      logPrefix: 'sse.builder_layout',
    })

    expect(useWizardStore.getState().builderLayoutByApp[APP_ID]).toBeUndefined()
  })

  it('does nothing when there is no client app to scope to', () => {
    handleBuilderLayoutNotification({
      raw: { appId: APP_ID, builderLayout: { version: 1, layout: 'immersive' } },
      clientAppId: '',
      logPrefix: 'sse.builder_layout',
    })

    expect(useWizardStore.getState().builderLayoutByApp).toEqual({})
  })

  it('falls back to the client app id when the event omits appId', () => {
    handleBuilderLayoutNotification({
      raw: { builderLayout: { version: 1, layout: 'immersive' } },
      clientAppId: APP_ID,
      logPrefix: 'sse.builder_layout',
    })

    expect(useWizardStore.getState().builderLayoutByApp[APP_ID]).toEqual({
      version: 1,
      layout: 'immersive',
    })
  })
})
