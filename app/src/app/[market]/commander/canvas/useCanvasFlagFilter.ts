'use client'

import { useMemo } from 'react'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { CANVAS_REGISTRY, type CanvasId } from './registry'

const CANVAS_FLAG_NAMES = [
  'app-builder-inbox-button',
  'appbuilder-analytics',
  'appbuilder-automations',
  'appbuilder-domain-top-level',
  'appbuilder-github-sync',
  'appbuilder-marketing-campaigns',
  'appbuilder-media-library',
  'appbuilder-settings-backups',
  'appbuilder-settings-project',
  'appbuilder-settings-secrets',
  'appbuilder-settings-security',
  'appbuilder-settings-social',
  'appbuilder-settings-visualscan',
  'appbuilder-settings-commerce'
] as const

type CanvasFlagName = (typeof CANVAS_FLAG_NAMES)[number]

export function useCanvasFlagFilter(): (canvasId: CanvasId) => boolean {
  const flags: Record<CanvasFlagName, boolean> = {
    'app-builder-inbox-button': useSwitchboard('app-builder-inbox-button') === true,
    'appbuilder-analytics': useSwitchboard('appbuilder-analytics') === true,
    'appbuilder-automations': useSwitchboard('appbuilder-automations') === true,
    'appbuilder-domain-top-level': useSwitchboard('appbuilder-domain-top-level') === true,
    'appbuilder-github-sync': useSwitchboard('appbuilder-github-sync') === true,
    'appbuilder-marketing-campaigns': useSwitchboard('appbuilder-marketing-campaigns') === true,
    'appbuilder-media-library': useSwitchboard('appbuilder-media-library') === true,
    'appbuilder-settings-backups': useSwitchboard('appbuilder-settings-backups') === true,
    'appbuilder-settings-project': useSwitchboard('appbuilder-settings-project') === true,
    'appbuilder-settings-secrets': useSwitchboard('appbuilder-settings-secrets') === true,
    'appbuilder-settings-security': useSwitchboard('appbuilder-settings-security') === true,
    'appbuilder-settings-social': useSwitchboard('appbuilder-settings-social') === true,
    'appbuilder-settings-visualscan': useSwitchboard('appbuilder-settings-visualscan') === true,
    'appbuilder-settings-commerce': useSwitchboard('appbuilder-settings-commerce') === true
  }

  const flagKey = CANVAS_FLAG_NAMES.map((name) => (flags[name] ? '1' : '0')).join('')
  return useMemo(
    () => (canvasId: CanvasId) => {
      const descriptor = CANVAS_REGISTRY[canvasId]
      if (!descriptor) return false
      if (!descriptor.switchboardFlag) return true
      const flagName = descriptor.switchboardFlag as CanvasFlagName
      return flags[flagName] === true
    },
    [flagKey],
  )
}
