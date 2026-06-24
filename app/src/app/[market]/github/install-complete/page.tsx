'use client';

import { useEffect, useState } from 'react';

import { useTranslations } from '@/hooks/useTranslations';

const COUNTDOWN_SECONDS = 5;

export default function GitHubInstallComplete() {
  const t = useTranslations();
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(function countdown() {
    const timer = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          window.close();
          // Browsers silently block close() on tabs not opened via window.open();
          // always flip to the fallback message so the user sees a clear CTA.
          setCloseFailed(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] font-sans text-[#111]">
      <div className="flex flex-col items-center p-8">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-4"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <h1 className="mb-2 text-center text-2xl font-semibold">
          {t('builder_settings_github_install_complete_title', undefined, 'GitHub App installed')}
        </h1>
        <p className="mb-6 text-base text-[#555]">
          {t('builder_settings_github_install_complete_message', undefined, 'You can close this window now.')}
        </p>
        <p className="text-sm text-[#999]">
          {closeFailed
            ? t('builder_settings_github_install_complete_message', undefined, 'You can close this window now.')
            : t('builder_settings_github_install_complete_closing', { seconds }, 'Closing in {seconds} seconds…')}
        </p>
      </div>
    </div>
  );
}
