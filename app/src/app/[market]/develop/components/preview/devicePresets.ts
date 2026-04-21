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

/**
 * Get device preset by ID
 */
export function getDevicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find(preset => preset.id === id)
}

/**
 * Get all devices by category
 */
export function getDevicesByCategory(category: DevicePreset['category']): DevicePreset[] {
  return DEVICE_PRESETS.filter(preset => preset.category === category)
}

/**
 * Default device for mobile preview
 */
export const DEFAULT_MOBILE_DEVICE = 'iphone-17-pro'

/**
 * Default device for tablet preview
 */
export const DEFAULT_TABLET_DEVICE = 'ipad'
