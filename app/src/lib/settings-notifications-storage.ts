import { SettingsSection } from '@/app/[market]/develop/components/types';

// Session-scoped "action needed" markers for Settings sub-sections, keyed per app + section.
// sessionStorage (not localStorage) so a marker lives for the tab session only and never leaks
// across browser sessions. A CustomEvent is dispatched on every write because storage mutations
// alone don't trigger React re-renders — consumers subscribe to it (see useSettingsNotifications).
const PREFIX = 'airo-settings-notification:';
export const SETTINGS_NOTIFICATION_EVENT = 'appbuilder:settings-notification-updated';

function storageKey(appId: string, section: SettingsSection): string {
  return `${PREFIX}${appId}:${section}`;
}

function emit(appId: string, section: SettingsSection): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_NOTIFICATION_EVENT, { detail: { appId, section } }));
}

export function markSettingsNotification(appId: string, section: SettingsSection): void {
  if (typeof window === 'undefined' || !appId) return;
  try {
    window.sessionStorage.setItem(storageKey(appId, section), 'true');
    emit(appId, section);
  } catch {
    // sessionStorage can throw in private browsing / quota-exceeded — the dot just won't show.
  }
}

export function clearSettingsNotification(appId: string, section: SettingsSection): void {
  if (typeof window === 'undefined' || !appId) return;
  try {
    window.sessionStorage.removeItem(storageKey(appId, section));
    emit(appId, section);
  } catch {
    // ignore
  }
}

export function getNotifiedSections(appId: string): Set<SettingsSection> {
  const result = new Set<SettingsSection>();
  if (typeof window === 'undefined' || !appId) return result;
  try {
    const appPrefix = `${PREFIX}${appId}:`;
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(appPrefix) && window.sessionStorage.getItem(key) === 'true') {
        result.add(key.slice(appPrefix.length) as SettingsSection);
      }
    }
  } catch {
    // ignore
  }
  return result;
}
