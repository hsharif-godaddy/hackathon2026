import type { BuilderLayoutDescriptor } from './builder-layout.js'

export const DESIGN_KIT_BUILD_CANVAS_ID = 'design-kit-build' as const

export type DesignKitBuildPhase = 'gathering' | 'brand' | 'website' | 'ready'

export function isDesignKitBuildCanvas(id: unknown): id is typeof DESIGN_KIT_BUILD_CANVAS_ID {
  return id === DESIGN_KIT_BUILD_CANVAS_ID
}

export function designKitLayoutForPhase(
  isDesignKitApp: boolean,
  phase: DesignKitBuildPhase | undefined,
): BuilderLayoutDescriptor {
  if (!isDesignKitApp || phase === 'ready') {
    return { version: 1, layout: 'default' }
  }

  if (phase === 'brand' || phase === 'website') {
    return { version: 1, layout: 'immersive', pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID } }
  }

  return { version: 1, layout: 'immersive' }
}
