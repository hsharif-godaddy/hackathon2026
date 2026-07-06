export const BUILDER_LAYOUT_VERSION = 1 as const

export type BuilderCanvasId = string

export type BuilderLayoutKind = 'immersive' | 'default' | 'commander' | 'develop'

export type BuilderPinnedSurface = { canvasId: BuilderCanvasId }

export type BuilderLayoutDescriptor =
  | { version: 1; layout: 'immersive'; pinnedSurface?: BuilderPinnedSurface }
  | { version: 1; layout: 'default' }
  | { version: 1; layout: 'commander'; initialCanvasId?: BuilderCanvasId }
  | { version: 1; layout: 'develop' }

export const DEFAULT_BUILDER_LAYOUT: BuilderLayoutDescriptor = Object.freeze({
  version: BUILDER_LAYOUT_VERSION,
  layout: 'default',
})

export function builderLayoutVariant(descriptor: BuilderLayoutDescriptor): string {
  if (descriptor.layout === 'immersive' && descriptor.pinnedSurface) {
    return `immersive:${descriptor.pinnedSurface.canvasId}`
  }
  return descriptor.layout
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeBuilderLayout(raw: unknown): BuilderLayoutDescriptor {
  if (!isRecord(raw) || raw.version !== BUILDER_LAYOUT_VERSION) {
    return DEFAULT_BUILDER_LAYOUT
  }

  switch (raw.layout) {
    case 'immersive': {
      const canvasId = isRecord(raw.pinnedSurface) ? raw.pinnedSurface.canvasId : undefined
      return typeof canvasId === 'string'
        ? { version: 1, layout: 'immersive', pinnedSurface: { canvasId } }
        : { version: 1, layout: 'immersive' }
    }
    case 'commander':
      return typeof raw.initialCanvasId === 'string'
        ? { version: 1, layout: 'commander', initialCanvasId: raw.initialCanvasId }
        : { version: 1, layout: 'commander' }
    case 'develop':
      return { version: 1, layout: 'develop' }
    case 'default':
      return { version: 1, layout: 'default' }
    default:
      return DEFAULT_BUILDER_LAYOUT
  }
}
