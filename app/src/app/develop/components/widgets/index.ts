/**
 * Widget Registry
 *
 * Central registry for all available widget components.
 * Maps widget types to their React components.
 */

import ColorPaletteWidget, { type ColorPaletteWidgetProps } from './ColorPaletteWidget'
import ColorPaletteGridWidget, { type ColorPaletteGridWidgetProps } from './ColorPaletteGridWidget'
import FontPaletteWidget, { type FontPaletteWidgetProps } from './FontPaletteWidget'
import { SocialPostList } from './SocialPostList'
import type { SocialPostData } from '@/types/social-posts'

export interface SocialPostListProps {
  posts?: SocialPostData[];
}

/**
 * Widget component props union type
 */
export type WidgetProps = ColorPaletteWidgetProps | ColorPaletteGridWidgetProps | FontPaletteWidgetProps | SocialPostListProps

/**
 * Widget registry mapping widget types to components
 */
export const widgetRegistry = {
  'color-palette': ColorPaletteWidget,
  'color-palette-grid': ColorPaletteGridWidget,
  'typography': FontPaletteWidget,
  'social-post-list': SocialPostList,
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
export {
  ColorPaletteWidget,
  ColorPaletteGridWidget,
  FontPaletteWidget,
  SocialPostList
}

export type {
  ColorPaletteWidgetProps,
  ColorPaletteGridWidgetProps,
  FontPaletteWidgetProps
}

export {
  saveWidgetState,
  loadWidgetState,
  clearWidgetState,
  clearExpiredWidgetStates
} from './widget-state-persistence'

