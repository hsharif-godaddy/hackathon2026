'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@ux/box';
import text from '@ux/text';

import { useBrandData } from '@/hooks/useBrandData';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { logger } from '@/lib/request-context';
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

export default function BrandBookView({ appId }: BrandBookViewProps) {
  const { data, isLoading, error } = useBrandData(appId);
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

    const primarySlot = manifest?.['logo/primary'];
    const horizontalSlot = manifest?.['logo/horizontal'];
    const verticalSlot = manifest?.['logo/vertical'];

    return primarySlot?.currentUrl || horizontalSlot?.currentUrl || verticalSlot?.currentUrl || undefined;
  }, [previewLogoUrl, isManifestLoading, manifestError, manifest, appId]);

  // Solid-variant logo for the brand book light panel (falls back to transparent if no solid mapping exists)
  const primarySolidLogoUrl = useMemo(() => {
    if (previewSolidUrl) return previewSolidUrl;
    if (previewLogoUrl) return previewLogoUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) return undefined;

    const slots = [manifest?.['logo/primary'], manifest?.['logo/horizontal'], manifest?.['logo/vertical']];
    for (const slot of slots) {
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      return slot?.solidUrlMap?.[transparentUrl] || transparentUrl;
    }

    return undefined;
  }, [previewSolidUrl, previewLogoUrl, isManifestLoading, manifestError, manifest]);

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

    const slots = [manifest?.['logo/primary'], manifest?.['logo/horizontal'], manifest?.['logo/vertical']];
    for (const slot of slots) {
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      return slot?.reversedSolidUrlMap?.[transparentUrl] || slot?.reversedUrlMap?.[transparentUrl] || transparentUrl;
    }

    return undefined;
  }, [previewReversedUrl, previewLogoUrl, isManifestLoading, manifestError, manifest, appId]);

  const primaryMockupUrl = useMemo(() => {
    if (previewMockupUrl) return previewMockupUrl;
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    const slots = [manifest?.['logo/primary'], manifest?.['logo/horizontal'], manifest?.['logo/vertical']];
    for (const slot of slots) {
      const transparentUrl = slot?.currentUrl;
      if (!transparentUrl) continue;
      return slot?.landscapeMockupUrlMap?.[transparentUrl] || slot?.mockupUrlMap?.[transparentUrl];
    }

    return undefined;
  }, [previewMockupUrl, isManifestLoading, manifestError, manifest, appId]);

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

  // Genuine API failure after retries — show error state
  if (error && !data && !isLoading) {
    return (
      <Box
        inlineAlignChildren="center"
        blockAlignChildren="center"
        stretch
        className="bg-intents-ux-boxLowContrast-backgroundColor"
        data-testid="brand-book-error"
      >
        <text.span as="paragraph">Unable to load brand data. Try refreshing the page.</text.span>
      </Box>
    );
  }

  // Loading, or no data yet (agent hasn't written brand data during initial creation)
  if (!data) {
    return (
      <div
        className="h-full flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor"
        data-testid="brand-book-loading"
      >
        <text.span as="paragraph">Creating your logo &amp; brand...</text.span>
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
