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

  // Stable logo-slot resolution: pick the first non-pending slot with content, but once
  // resolved, keep showing that same slot across manifest refetches. This prevents the
  // displayed logo from swapping when followUpVariants populates a higher-priority slot.
  const resolvedSlotRef = useRef<string | null>(null);
  const activeLogoSlot: string | null = useMemo(() => {
    if (previewLogoUrl || isManifestLoading || !manifest) return null;

    const prev: string | null = resolvedSlotRef.current;
    if (prev) {
      const slot = manifest[prev];
      if (slot?.currentUrl && !slot.pendingJobId) return prev;
    }

    for (const slotName of LOGO_SLOT_NAMES) {
      const slot = manifest[slotName];
      if (slot?.pendingJobId) continue;
      if (slot?.currentUrl) return slotName;
    }
    return null;
  }, [previewLogoUrl, isManifestLoading, manifest]);

  useEffect(() => {
    if (activeLogoSlot) resolvedSlotRef.current = activeLogoSlot;
  }, [activeLogoSlot]);

  const primaryLogoUrl = useMemo(() => {
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    if (!activeLogoSlot) return undefined;
    const slot = manifest?.[activeLogoSlot];
    return slot?.currentUrl ? getSlotImageUrl(activeLogoSlot, slot.currentUrl, previewBaseUrl) : undefined;
  }, [previewLogoUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, appId, activeLogoSlot]);

  // Solid-variant logo for the brand book light panel (falls back to transparent if no solid mapping exists)
  const primarySolidLogoUrl = useMemo(() => {
    if (previewSolidUrl) return previewSolidUrl;
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) return undefined;

    if (!activeLogoSlot) return undefined;
    const slot = manifest?.[activeLogoSlot];
    const transparentUrl = slot?.currentUrl;
    if (!transparentUrl) return undefined;
    const url = slot?.solidUrlMap?.[transparentUrl] || transparentUrl;
    return getSlotImageUrl(activeLogoSlot, url, previewBaseUrl);
  }, [previewSolidUrl, previewLogoUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, activeLogoSlot]);

  const primaryMockupUrl = useMemo(() => {
    if (previewMockupUrl) return previewMockupUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    // Prefer active slot's mockup, fall through to others if it doesn't have one
    const slotOrder: readonly string[] = activeLogoSlot
      ? [activeLogoSlot, ...LOGO_SLOT_NAMES.filter((n) => n !== activeLogoSlot)]
      : LOGO_SLOT_NAMES;

    for (const slotName of slotOrder) {
      const slot = manifest?.[slotName];
      if (slot?.pendingJobId) continue;
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      const url = slot?.landscapeMockupUrlMap?.[transparentUrl] || slot?.mockupUrlMap?.[transparentUrl];
      if (!url) continue;
      return getSlotImageUrl(slotName, url, previewBaseUrl);
    }

    return undefined;
  }, [previewMockupUrl, isManifestLoading, manifestError, manifest, previewBaseUrl, appId, activeLogoSlot]);

  const { isLogoPending, priorLightLogoUrl } = useMemo(() => {
    if (previewLogoUrl) {
      return { isLogoPending: false, priorLightLogoUrl: undefined };
    }
    // No resolved slot: show shimmer if manifest is still loading (brand data exists
    // so logos are expected) or ANY slot is mid-generation
    if (!activeLogoSlot) {
      const anyPending: boolean = isManifestLoading
        || LOGO_SLOT_NAMES.some((name) => !!manifest?.[name]?.pendingJobId);
      return { isLogoPending: anyPending, priorLightLogoUrl: undefined };
    }
    // Active slot exists: only pending if THAT slot is mid-generation
    const slot = manifest?.[activeLogoSlot];
    if (slot?.pendingJobId) {
      const prior: string | undefined = slot.priorUrl;
      return { isLogoPending: true, priorLightLogoUrl: slot.solidUrlMap?.[prior ?? ''] ?? prior ?? undefined };
    }
    return { isLogoPending: false, priorLightLogoUrl: undefined };
  }, [previewLogoUrl, manifest, activeLogoSlot, isManifestLoading]);

  // Fire book_view impression once all brand data sections are populated
  useEffect(() => {
    if (bookViewFiredRef.current) return;
    if (!data?.palette || !data?.typography || !primaryLogoUrl) return;
    bookViewFiredRef.current = true;
    logImpressionEvent('develop.brand.book_view', {
      appId,
      flow: 'logo-designer',
    })();
  }, [data, primaryLogoUrl, appId]);

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
        appId={appId}
        brand={brand}
        palette={palette}
        logoUrl={primarySolidLogoUrl}
        isLoading={isGenerating}
        isPending={isLogoPending}
        priorLightLogoUrl={priorLightLogoUrl}
        generatedForSurfaceColor={activeLogoSlot ? manifest?.[activeLogoSlot]?.generatedForSurfaceColor : undefined}
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
