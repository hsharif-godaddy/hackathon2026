/**
 * Default English copy for canvas status pill keys (dev fallback until published in @airo-app-builder/aab).
 *
 * Spec: docs/superpowers/plans/2026-06-18-canvas-status-pill-copy.md
 */
export const CANVAS_STATUS_DEFAULT_MESSAGES = {
  builder_canvas_status_checking_project: 'Checking your project',
  builder_canvas_status_updating_project: 'Updating your project',
  builder_canvas_status_planning: 'Planning',
  builder_canvas_status_adding_styles: 'Adding styles',
  builder_canvas_status_setting_up: 'Setting things up',
  builder_canvas_status_building: 'Building',
  builder_canvas_status_wrapping_up: 'Wrapping up a task',
  builder_canvas_status_restoring: 'Restoring',
  builder_canvas_status_working: 'Working',
} satisfies Record<string, string>

export type CanvasStatusKey = keyof typeof CANVAS_STATUS_DEFAULT_MESSAGES

export function defaultMessageForCanvasStatusKey(key: CanvasStatusKey): string {
  return CANVAS_STATUS_DEFAULT_MESSAGES[key]
}
