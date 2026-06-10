import { useEffect, useState } from 'react';

import { SettingsSection } from '@/app/[market]/develop/components/types';
import {
  getNotifiedSections,
  SETTINGS_NOTIFICATION_EVENT,
} from '@/lib/settings-notifications-storage';

export interface SettingsNotifications {
  sections: Set<SettingsSection>;
  hasAny: boolean;
  has: (section: SettingsSection) => boolean;
}

/**
 * Reactive view of the session-scoped Settings notification registry for a given app.
 * Re-reads on appId change and whenever a SETTINGS_NOTIFICATION_EVENT fires for this app.
 * The `sections` Set reference is stable between writes, so it is safe to use in effect deps.
 */
export function useSettingsNotifications(appId: string | undefined): SettingsNotifications {
  const [sections, setSections] = useState<Set<SettingsSection>>(() =>
    appId ? getNotifiedSections(appId) : new Set()
  );

  useEffect(() => {
    if (!appId) {
      setSections(new Set());
      return;
    }

    setSections(getNotifiedSections(appId));

    const onUpdate = (event: Event) => {
      if ((event as CustomEvent).detail?.appId === appId) {
        setSections(getNotifiedSections(appId));
      }
    };

    window.addEventListener(SETTINGS_NOTIFICATION_EVENT, onUpdate);
    return () => window.removeEventListener(SETTINGS_NOTIFICATION_EVENT, onUpdate);
  }, [appId]);

  return {
    sections,
    hasAny: sections.size > 0,
    has: (section: SettingsSection) => sections.has(section),
  };
}
