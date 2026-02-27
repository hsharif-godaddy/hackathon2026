/**
 * Widget Registry
 *
 * Central registry for all available widget components.
 * Maps widget types to their React components.
 */

import type { DomainPurchaseWidgetProps } from '@/types/domain-purchase'
import ColorPaletteGridWidget, { type ColorPaletteGridWidgetProps } from './ColorPaletteGridWidget'
import ColorPaletteWidget, { type ColorPaletteWidgetProps } from './ColorPaletteWidget'
import DomainAttachWidget, { type DomainAttachWidgetProps } from './DomainAttachWidget'
import DomainPurchaseWidget from './DomainPurchaseWidget'
import FeedbackWidget, { type FeedbackWidgetProps } from './FeedbackWidget'
import FontPaletteWidget, { type FontPaletteWidgetProps } from './FontPaletteWidget'
import FontThemeGridWidget, { type FontThemeGridWidgetProps } from './FontThemeGridWidget'

/**
 * Widget component props union type
 */
export type WidgetProps = ColorPaletteWidgetProps | ColorPaletteGridWidgetProps | FontPaletteWidgetProps | FontThemeGridWidgetProps | FeedbackWidgetProps | DomainPurchaseWidgetProps | DomainAttachWidgetProps;

/**
 * Widget registry mapping widget types to components
 */
export const widgetRegistry = {
  'color-palette': ColorPaletteWidget,
  'color-palette-grid': ColorPaletteGridWidget,
  'domain-attach': DomainAttachWidget,
  'domain-purchase': DomainPurchaseWidget,
  'feedback': FeedbackWidget,
  'font-theme-grid': FontThemeGridWidget,
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
  DomainAttachWidget,
  DomainPurchaseWidget,
  FeedbackWidget,
  FontPaletteWidget,
  FontThemeGridWidget
}

export type {
  ColorPaletteGridWidgetProps,
  ColorPaletteWidgetProps,
  DomainAttachWidgetProps,
  DomainPurchaseWidgetProps,
  FeedbackWidgetProps,
  FontPaletteWidgetProps,
  FontThemeGridWidgetProps
}

export {
  clearExpiredWidgetStates,
  clearWidgetState,
  loadWidgetState,
  saveWidgetState
} from './widget-state-persistence'
