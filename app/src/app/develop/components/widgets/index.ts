/**
 * Widget Registry
 * 
 * Central registry for all available widget components.
 * Maps widget types to their React components.
 */

import ColorPaletteWidget, { type ColorPaletteWidgetProps } from './ColorPaletteWidget'
import FontPaletteWidget, { type FontPaletteWidgetProps } from './FontPaletteWidget'

/**
 * Widget component props union type
 */
export type WidgetProps = ColorPaletteWidgetProps | FontPaletteWidgetProps

/**
 * Widget registry mapping widget types to components
 */
export const widgetRegistry = {
  'color-palette': ColorPaletteWidget,
  'typography': FontPaletteWidget,
} as const

/**
 * Widget type names
 */
export type WidgetType = keyof typeof widgetRegistry

/**
 * Check if a widget type is registered
 */
export function isValidWidgetType(type: string): type is WidgetType {
  return type in widgetRegistry
}

/**
 * Get widget component by type
 */
export function getWidgetComponent(type: string) {
  if (isValidWidgetType(type)) {
    return widgetRegistry[type]
  }
  return null
}

/**
 * Export widget components
 */
export { ColorPaletteWidget, FontPaletteWidget }
export type { ColorPaletteWidgetProps, FontPaletteWidgetProps }

