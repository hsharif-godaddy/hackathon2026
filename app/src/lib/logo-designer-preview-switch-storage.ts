// The `initial-template-${appId}` sessionStorage key is cleared the moment the
// first prompt is sent (see useInitialization.markInitialPromptSent). Later
// logic that needs to know "this app originated from the logo-designer
// template" — such as the Brand → Preview auto-switch that fires after a
// handoff chain produces file edits — can't rely on that signal anymore.
// These localStorage markers persist for the app so post-prompt code (and
// reloads mid-flow) can still recognize a logo-designer origin.
const IS_LOGO_DESIGNER_PREFIX = 'airo-logo-designer-app:'
const AUTO_SWITCHED_PREFIX = 'airo-logo-designer-auto-switched-preview:'

function isLogoDesignerKey(appId: string): string {
  return `${IS_LOGO_DESIGNER_PREFIX}${appId}`
}

function autoSwitchedKey(appId: string): string {
  return `${AUTO_SWITCHED_PREFIX}${appId}`
}

export function isLogoDesignerApp(appId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(isLogoDesignerKey(appId)) === 'true'
  } catch {
    return false
  }
}

export function markLogoDesignerApp(appId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(isLogoDesignerKey(appId), 'true')
  } catch {
    // localStorage can throw in private browsing / quota-exceeded. The
    // Brand→Preview auto-switch just won't fire on the next reload; prefer
    // that over a noisy failure.
  }
}

export function hasAutoSwitchedLogoDesignerPreview(appId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(autoSwitchedKey(appId)) === 'true'
  } catch {
    return false
  }
}

export function markAutoSwitchedLogoDesignerPreview(appId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(autoSwitchedKey(appId), 'true')
  } catch {
    // See note on markLogoDesignerApp.
  }
}
