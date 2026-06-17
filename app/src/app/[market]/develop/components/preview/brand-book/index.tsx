'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import { useBrandData } from '@/hooks/useBrandData';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { logImpressionEvent } from '@/utils/instrumentation';
import styles from './brand-book.module.css';
import { useBrandIntentOverrides, useBrandStyle, useGoogleFonts, useIsBrandGenerating } from './hooks';
import {
  BrandApplicationsSection,
  ColorContextsSection,
  ColorSection,
  HeroSection,
  LogoSection,
  TypographySection,
  UsageGuidelinesSection,
} from './sections';
import { Footer } from './shared-components';
import type { BrandBookViewProps } from './types';

const LOGO_SLOT_NAMES = ['logo/primary', 'logo/horizontal', 'logo/vertical'] as const;

export default function BrandBookView({ appId }: BrandBookViewProps) {
  // Wait for develop-page hydration before hitting the agent — calling /brand-data
  // before the app/alloc exists returns 401 and creates a flurry of failed requests.
  const isAppHydrated = useDevelopPageStore(
    (state) => state.currentAppId === appId && state.loadingPhase === 'ready',
  );
  const { data, isLoading: isBrandDataLoading } = useBrandData(appId, { enabled: isAppHydrated });
  const logoViewFiredRef = useRef(false);
  const bookViewFiredRef = useRef(false);

  const brandName = data?.brandName || 'Your Brand';

  // Load Google Fonts for the brand's typography
  useGoogleFonts(data?.typography);

  // Compute derived brand style values (fonts, accent colors)
  const brand = useBrandStyle(data?.palette, data?.typography);

  // Override UXCore intent CSS variables so all child components use brand palette
  const intentOverrides = useBrandIntentOverrides(data?.palette, data?.typography);

  // Read media manifest to get logo slot URLs (single source of truth for logo images)
  const { manifest, isLoading: isManifestLoading, error: manifestError } = useMediaManifest({ appId });

  // Preview server origin for resolving relative agent-container paths (uploads, slot proxy).
  // Uploaded logos land at /airo-assets/uploads/<file> which only resolves through the preview origin.
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url || null;

  // True once any brand tool has started in the current stream
  const isGenerating = useIsBrandGenerating();

  // Track logo preview override from chat selection (logo-select event)
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);
  const [previewSolidUrl, setPreviewSolidUrl] = useState<string | null>(null);
  const [previewReversedUrl, setPreviewReversedUrl] = useState<string | null>(null);
  const [previewMockupUrl, setPreviewMockupUrl] = useState<string | null>(null);

  useEffect(() => {
    function handleLogoEvent(event: Event) {
      const logo = (event as CustomEvent).detail;
      const url = logo?.transparentUrl || logo?.horizontalTransparentUrl || logo?.verticalTransparentUrl;
      if (!url) {
        logger.warn('brandBook.logoEvent.noUsableUrl', { eventType: event.type, detail: logo });
        return;
      }
      setPreviewLogoUrl(url);
      // Reset to null when the new logo lacks a variant so the manifest fallback can re-engage —
      // otherwise the prior logo's state leaks across selections (mismatched light/dark/mockup tuple).
      const solid = logo?.solidUrl || logo?.horizontalSolidUrl || logo?.verticalSolidUrl;
      setPreviewSolidUrl(solid || null);
      const reversed =
        logo?.reversedSolidUrl || logo?.horizontalReversedSolidUrl || logo?.verticalReversedSolidUrl ||
        logo?.reversedUrl || logo?.horizontalReversedUrl || logo?.verticalReversedUrl;
      setPreviewReversedUrl(reversed || null);
      const mockup = logo?.landscapeMockupUrl || logo?.horizontalLandscapeMockupUrl || logo?.verticalLandscapeMockupUrl
        || logo?.mockupUrl || logo?.horizontalMockupUrl || logo?.verticalMockupUrl;
      setPreviewMockupUrl(mockup || null);

      if (event.type === 'logo-generated' && !logoViewFiredRef.current) {
        logoViewFiredRef.current = true;
        logImpressionEvent('develop.brand.logo_view', {
          appId,
          flow: 'logo-designer',
        })();
      }
    }
    window.addEventListener('logo-select', handleLogoEvent);
    window.addEventListener('logo-generated', handleLogoEvent);
    return () => {
      window.removeEventListener('logo-select', handleLogoEvent);
      window.removeEventListener('logo-generated', handleLogoEvent);
    };
  }, [appId]);

  const primaryLogoUrl = useMemo(() => {
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest?.[slotName];
      if (slot?.currentUrl) return getSlotImageUrl(slotName, slot.currentUrl, previewBaseUrl);
    }
    return undefined;
  }, [previewLogoUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, appId]);

  // Solid-variant logo for the brand book light panel (falls back to transparent if no solid mapping exists)
  const primarySolidLogoUrl = useMemo(() => {
    if (previewSolidUrl) return previewSolidUrl;
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) return undefined;

    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest?.[slotName];
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      const url = slot?.solidUrlMap?.[transparentUrl] || transparentUrl;
      return getSlotImageUrl(slotName, url, previewBaseUrl);
    }

    return undefined;
  }, [previewSolidUrl, previewLogoUrl, isManifestLoading, manifestError, manifest, previewBaseUrl]);

  const reversedLogoUrl = useMemo(() => {
    if (previewReversedUrl) return previewReversedUrl;
    // Fall back to the transparent preview when a chat event lacked a reversed variant —
    // mirrors primarySolidLogoUrl so the dual panel still renders.
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest?.[slotName];
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      const url = slot?.reversedSolidUrlMap?.[transparentUrl] || slot?.reversedUrlMap?.[transparentUrl] || transparentUrl;
      return getSlotImageUrl(slotName, url, previewBaseUrl);
    }

    return undefined;
  }, [previewReversedUrl, previewLogoUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, appId]);

  const primaryMockupUrl = useMemo(() => {
    if (previewMockupUrl) return previewMockupUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest?.[slotName];
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      const url = slot?.landscapeMockupUrlMap?.[transparentUrl] || slot?.mockupUrlMap?.[transparentUrl];
      if (!url) continue;
      return getSlotImageUrl(slotName, url, previewBaseUrl);
    }

    return undefined;
  }, [previewMockupUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, appId]);

  // Pending-job state plus the prior hosted logo URLs to show during a *regeneration*.
  //
  // SHARED CONTRACT: when a logo slot has pendingJobId set AND its currentUrl is a real hosted
  // https logo, this is a regeneration — surfaces show the EXISTING logo (dimmed) with an animated
  // "updating" overlay sheen. When pendingJobId is set but currentUrl is the shimmer-asset path
  // (not http), it's a fresh generation — surfaces show a bare animated shimmer.
  //
  // A chat-selected logo (previewLogoUrl) means a real logo already arrived, so it wins over any
  // pending flag. Otherwise we honor the first logo slot that is either pending or has a currentUrl
  // — mirroring the first-match ordering used by the URL memos above — so the shimmer maps to the
  // same slot that would otherwise drive the logo image.
  //
  // priorLightUrl / priorDarkUrl are only populated for a regeneration; the dark panel prefers the
  // reversed-solid / reversed variant of the prior currentUrl (falling back to the light prior).
  const { isLogoPending, priorLightLogoUrl, priorDarkLogoUrl } = useMemo(() => {
    if (previewLogoUrl) {
      return { isLogoPending: false, priorLightLogoUrl: undefined, priorDarkLogoUrl: undefined };
    }
    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest?.[slotName];
      if (!slot) continue;
      if (slot.pendingJobId) {
        const prior = slot.currentUrl;
        // Regeneration only when the prior currentUrl is a real hosted logo (startsWith http).
        if (prior && (prior.startsWith('http://') || prior.startsWith('https://'))) {
          const light = getSlotImageUrl(slotName, slot.solidUrlMap?.[prior] || prior, previewBaseUrl);
          const darkSource =
            slot.reversedSolidUrlMap?.[prior] || slot.reversedUrlMap?.[prior] || prior;
          const dark = getSlotImageUrl(slotName, darkSource, previewBaseUrl);
          return { isLogoPending: true, priorLightLogoUrl: light, priorDarkLogoUrl: dark };
        }
        // Fresh generation — bare shimmer, no prior URL.
        return { isLogoPending: true, priorLightLogoUrl: undefined, priorDarkLogoUrl: undefined };
      }
      if (slot.currentUrl) {
        return { isLogoPending: false, priorLightLogoUrl: undefined, priorDarkLogoUrl: undefined };
      }
    }
    return { isLogoPending: false, priorLightLogoUrl: undefined, priorDarkLogoUrl: undefined };
  }, [previewLogoUrl, manifest, previewBaseUrl]);

  // Fire book_view impression once all brand data sections are populated
  useEffect(() => {
    if (bookViewFiredRef.current) return;
    if (!data?.palette || !data?.typography || !primaryLogoUrl || !reversedLogoUrl) return;
    bookViewFiredRef.current = true;
    logImpressionEvent('develop.brand.book_view', {
      appId,
      flow: 'logo-designer',
    })();
  }, [data, primaryLogoUrl, reversedLogoUrl, appId]);

  if (!data) {
    const showLoadingMessage = isGenerating || isBrandDataLoading || !isAppHydrated;
    return (
      <div
        className="h-full flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor"
        data-testid={showLoadingMessage ? 'brand-book-loading' : 'brand-book-empty'}
      >
        <text.span as="paragraph">
          {showLoadingMessage
            ? 'Creating your logo & brand...'
            : 'To get started, ask to create a logo in chat.'}
        </text.span>
      </div>
    );
  }

  const palette = data?.palette;

  return (
    <div
      className={`${styles.root} bg-intents-ux-boxLowContrast-backgroundColor`}
      style={intentOverrides}
      data-testid="brand-book-view"
    >
      <HeroSection
        brandName={brandName}
        palette={palette}
      />
      <LogoSection
        brand={brand}
        palette={palette}
        logoUrl={primarySolidLogoUrl}
        reversedLogoUrl={reversedLogoUrl}
        isLoading={isGenerating}
        isPending={isLogoPending}
        priorLightLogoUrl={priorLightLogoUrl}
        priorDarkLogoUrl={priorDarkLogoUrl}
      />
      <BrandApplicationsSection
        brand={brand}
        palette={palette}
        mockupUrl={primaryMockupUrl}
        isLoading={isGenerating}
      />
      <ColorSection
        palette={palette}
        brand={brand}
        isLoading={isGenerating}
      />
      <ColorContextsSection
        palette={palette}
        brand={brand}
        logoUrl={primaryLogoUrl}
        isLoading={isGenerating}
        isPending={isLogoPending}
        priorLogoUrl={priorLightLogoUrl}
      />
      <TypographySection
        data={data}
        brand={brand}
        brandName={brandName}
        palette={palette}
        isLoading={isGenerating}
      />
      <UsageGuidelinesSection
        palette={palette}
        brand={brand}
      />
      <Footer brandName={brandName} brand={brand} />
    </div>
  );
}
