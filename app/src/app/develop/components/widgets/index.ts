/**
 * Widget Registry
 *
 * Central registry for all available widget components.
 * Maps widget types to their React components.
 */

import type { SocialPostData } from '@/types/social-posts'
import ColorPaletteGridWidget, { type ColorPaletteGridWidgetProps } from './ColorPaletteGridWidget'
import ColorPaletteWidget, { type ColorPaletteWidgetProps } from './ColorPaletteWidget'
import FeedbackWidget, { type FeedbackWidgetProps } from './FeedbackWidget'
import FontPaletteWidget, { type FontPaletteWidgetProps } from './FontPaletteWidget'
import FontThemeGridWidget, { type FontThemeGridWidgetProps } from './FontThemeGridWidget'
import { SocialPostList } from './SocialPostList'

export interface SocialPostListProps {
  posts?: SocialPostData[];
}

/**
 * Widget component props union type
 */
export type WidgetProps = ColorPaletteWidgetProps | ColorPaletteGridWidgetProps | FontPaletteWidgetProps | FontThemeGridWidgetProps | SocialPostListProps | FeedbackWidgetProps

/**
 * Widget registry mapping widget types to components
 */
export const widgetRegistry = {
  'color-palette': ColorPaletteWidget,
  'color-palette-grid': ColorPaletteGridWidget,
  'feedback': FeedbackWidget,
  'font-theme-grid': FontThemeGridWidget,
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
  ColorPaletteGridWidget,
  ColorPaletteWidget,
  FeedbackWidget,
  FontPaletteWidget,
  FontThemeGridWidget,
  SocialPostList
}

export type {
  ColorPaletteGridWidgetProps,
  ColorPaletteWidgetProps,
  FeedbackWidgetProps,
  FontPaletteWidgetProps,
  FontThemeGridWidgetProps
}

export {
  clearExpiredWidgetStates,
  clearWidgetState,
  loadWidgetState,
  saveWidgetState} from './widget-state-persistence'

