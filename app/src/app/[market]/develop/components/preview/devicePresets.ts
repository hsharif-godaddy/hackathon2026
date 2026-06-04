/**
 * Device presets for preview mode with accurate viewport dimensions.
 * Dimensions are based on CSS pixel dimensions (not physical pixels).
 */

import { PreviewViewMode } from '@/app/[market]/develop/components/types'

export interface DevicePreset {
  id: string
  name: string
  width: number
  height: number
  category: PreviewViewMode
}

/**
 * Common device presets organized by category
 */
export const CANONICAL_BREAKPOINTS: DevicePreset[] = [
  { id: 'desktop', name: 'Desktop', width: 0, height: 0, category: PreviewViewMode.DESKTOP },
  { id: 'mobile', name: 'Mobile', width: 390, height: 844, category: PreviewViewMode.MOBILE },
  { id: 'tablet', name: 'Tablet', width: 768, height: 1024, category: PreviewViewMode.TABLET },
]

export const DEVICE_PRESETS: DevicePreset[] = [
  // Full size (responsive)
  { id: 'full', name: 'Full size', width: 0, height: 0, category: PreviewViewMode.DESKTOP },

  // Phones - iPhone
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, category: PreviewViewMode.MOBILE },
  { id: 'iphone-air', name: 'iPhone Air', width: 430, height: 932, category: PreviewViewMode.MOBILE },
  { id: 'iphone-17', name: 'iPhone 17', width: 393, height: 852, category: PreviewViewMode.MOBILE },
  { id: 'iphone-17-pro', name: 'iPhone 17 Pro', width: 393, height: 852, category: PreviewViewMode.MOBILE },
  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', width: 430, height: 932, category: PreviewViewMode.MOBILE },

  // Phones - Google Pixel
  { id: 'pixel-10', name: 'Pixel 10', width: 412, height: 915, category: PreviewViewMode.MOBILE },
  { id: 'pixel-10-pro', name: 'Pixel 10 Pro', width: 412, height: 915, category: PreviewViewMode.MOBILE },
  { id: 'pixel-10-pro-xl', name: 'Pixel 10 Pro XL', width: 448, height: 998, category: PreviewViewMode.MOBILE },

  // Phones - Samsung Galaxy
  { id: 'galaxy-s25', name: 'Samsung Galaxy S25', width: 412, height: 915, category: PreviewViewMode.MOBILE },
  { id: 'galaxy-s25-plus', name: 'Samsung Galaxy S25+', width: 412, height: 915, category: PreviewViewMode.MOBILE },
  { id: 'galaxy-s25-ultra', name: 'Samsung Galaxy S25 Ultra', width: 448, height: 998, category: PreviewViewMode.MOBILE },

  // Tablets
  { id: 'ipad-mini', name: 'iPad Mini', width: 744, height: 1133, category: PreviewViewMode.TABLET },
  { id: 'ipad', name: 'iPad', width: 820, height: 1180, category: PreviewViewMode.TABLET },
  { id: 'ipad-air', name: 'iPad Air', width: 820, height: 1180, category: PreviewViewMode.TABLET },
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', width: 834, height: 1194, category: PreviewViewMode.TABLET },
  { id: 'ipad-pro-13', name: 'iPad Pro 13"', width: 1024, height: 1366, category: PreviewViewMode.TABLET },
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', width: 800, height: 1280, category: PreviewViewMode.TABLET },
]

export const CANONICAL_DEVICE_IDS = {
  [PreviewViewMode.DESKTOP]: 'desktop',
  [PreviewViewMode.MOBILE]: 'mobile',
  [PreviewViewMode.TABLET]: 'tablet',
} as const satisfies Record<PreviewViewMode, string>

/**
 * Get device preset by ID
 */
export function getDevicePreset(id: string): DevicePreset | undefined {
  return CANONICAL_BREAKPOINTS.find((preset) => preset.id === id)
    ?? DEVICE_PRESETS.find((preset) => preset.id === id)
}

/**
 * Get all devices by category (canonical breakpoint first, then detailed presets)
 */
export function getDevicesByCategory(category: DevicePreset['category']): DevicePreset[] {
  const canonical = CANONICAL_BREAKPOINTS.find((preset) => preset.category === category)
  const detailed = DEVICE_PRESETS.filter((preset) => preset.category === category)
  return canonical ? [canonical, ...detailed] : detailed
}

export function isCanonicalDevice(id: string): boolean {
  return CANONICAL_BREAKPOINTS.some((preset) => preset.id === id)
}

export function getCanonicalDeviceId(category: PreviewViewMode): string {
  return CANONICAL_DEVICE_IDS[category]
}

/**
 * Map legacy or detailed device ids to the canonical breakpoint for their category.
 */
export function resolveCanonicalDeviceId(id: string): string {
  if (isCanonicalDevice(id)) {
    return id
  }
  if (id === 'full') {
    return getCanonicalDeviceId(PreviewViewMode.DESKTOP)
  }
  const preset = DEVICE_PRESETS.find((device) => device.id === id)
  if (!preset) {
    return getCanonicalDeviceId(PreviewViewMode.DESKTOP)
  }
  return getCanonicalDeviceId(preset.category)
}

export function isFullWidthDevice(id: string): boolean {
  const preset = getDevicePreset(id)
  return preset?.width === 0 && preset?.height === 0
}

/**
 * Default device for desktop preview
 */
export const DEFAULT_DESKTOP_DEVICE = CANONICAL_DEVICE_IDS[PreviewViewMode.DESKTOP]

/**
 * Default device for mobile preview
 */
export const DEFAULT_MOBILE_DEVICE = CANONICAL_DEVICE_IDS[PreviewViewMode.MOBILE]

/**
 * Default device for tablet preview
 */
export const DEFAULT_TABLET_DEVICE = CANONICAL_DEVICE_IDS[PreviewViewMode.TABLET]
