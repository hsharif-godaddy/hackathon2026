'use client';

import { useEffect, useState } from 'react';
import Button from '@ux/button';

import { exitDarkRelease, getDarkReleaseVersion } from '@/lib/katana/dark-release';

/** Fixed banner height; mirrored into the `--dark-release-banner-h` CSS var so full-height
 *  pages can subtract it (default `0px` lives in globals.scss). */
const BANNER_HEIGHT = '2.5rem';

/**
 * Sticky top banner shown only when the browser is pinned to a Katana dark-release
 * artifact (the `x_katana_version` cookie is present). Displays the pinned version and an
 * Exit button that clears the cookie and reloads onto the live version.
 *
 * Internal-only chrome — only sessions that explicitly opted into a dark release see it —
 * so the copy is intentionally not internationalized.
 */
export default function DarkReleaseBanner() {
  const [version, setVersion] = useState<string | undefined>(undefined);

  // Read the cookie on the client after hydration (cookie is not HttpOnly).
  useEffect(() => {
    setVersion(getDarkReleaseVersion());
  }, []);

  // Reserve space for full-height pages only while the banner is shown.
  useEffect(() => {
    if (!version) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--dark-release-banner-h', BANNER_HEIGHT);
    return () => {
      root.style.setProperty('--dark-release-banner-h', '0px');
    };
  }, [version]);

  if (!version) return null;

  // Show the trailing 7 chars of the (typically 40-char SHA) selector; full value in `title`.
  const shortVersion = version.length > 7 ? version.slice(-7) : version;

  return (
    <div
      data-testid="dark-release-banner"
      role="status"
      style={{ height: BANNER_HEIGHT }}
      className="sticky top-0 z-[60] flex w-full items-center justify-center gap-2 px-3 bg-intents-ux-feedbackInfo-feedbackColor text-intents-ux-feedbackInfo-onFeedbackColor"
    >
      <span className="font-semibold uppercase tracking-wide">Dark release</span>
      <span className="truncate" title={version}>
        viewing version <code className="font-mono">{shortVersion}</code>
      </span>
      <Button
        data-testid="dark-release-exit"
        design="secondary"
        size="sm"
        text="Exit"
        onClick={exitDarkRelease}
      />
    </div>
  );
}
