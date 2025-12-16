"use client";

import Alert from '@ux/alert';

import { useTranslations } from '@/hooks/useTranslations';

export default function AppInactivityAlert() {
  const t = useTranslations();
  return (
    <div className="mb-3">
      <Alert emphasis="highlight" title={t('builder_layout_inactivity_alert_title')}>
        {t('builder_layout_inactivity_alert')}
      </Alert>
    </div>
  );
}
