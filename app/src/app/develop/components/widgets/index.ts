/**
 * Widget Registry
 * 
 * Central registry for all available widget components.
 * Maps widget types to their React components.
 */

import ColorPaletteWidget, { type ColorPaletteWidgetProps } from './ColorPaletteWidget'
import ColorPaletteGridWidget, { type ColorPaletteGridWidgetProps } from './ColorPaletteGridWidget'
import FontPaletteWidget, { type FontPaletteWidgetProps } from './FontPaletteWidget'

/**
 * Widget component props union type
 */
export type WidgetProps = ColorPaletteWidgetProps | ColorPaletteGridWidgetProps | FontPaletteWidgetProps

/**
 * Widget registry mapping widget types to components
 */
export const widgetRegistry = {
  'color-palette': ColorPaletteWidget,
  'color-palette-grid': ColorPaletteGridWidget,
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
export { ColorPaletteWidget, ColorPaletteGridWidget, FontPaletteWidget }
export type { ColorPaletteWidgetProps, ColorPaletteGridWidgetProps, FontPaletteWidgetProps }

