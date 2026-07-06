/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { DESIGN_KIT_BUILD_CANVAS_ID } from '@airo/shared'

import { descriptorToClientLayout } from './descriptorToClientLayout'
import { BuilderLayout } from './types'

describe('descriptorToClientLayout', () => {
  const base = BuilderLayout.Develop

  it('maps immersive to Immersive', () => {
    expect(
      descriptorToClientLayout(
        { version: 1, layout: 'immersive', pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID } },
        base,
      ),
    ).toBe(BuilderLayout.Immersive)
  })

  it('maps commander to Commander', () => {
    expect(descriptorToClientLayout({ version: 1, layout: 'commander' }, base)).toBe(
      BuilderLayout.Commander,
    )
  })

  it('maps develop to Develop', () => {
    expect(descriptorToClientLayout({ version: 1, layout: 'develop' }, base)).toBe(
      BuilderLayout.Develop,
    )
  })

  it('maps the neutral default layout to the provided base', () => {
    expect(descriptorToClientLayout({ version: 1, layout: 'default' }, BuilderLayout.Commander)).toBe(
      BuilderLayout.Commander,
    )
    expect(descriptorToClientLayout({ version: 1, layout: 'default' }, BuilderLayout.Develop)).toBe(
      BuilderLayout.Develop,
    )
  })
})
