'use client';

import { useEffect, useMemo, useState } from 'react';
import Box from '@ux/box';
import text from '@ux/text';

import { useBrandData } from '@/hooks/useBrandData';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { logger } from '@/lib/request-context';
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
      const reversed = logo?.reversedUrl || logo?.horizontalReversedUrl || logo?.verticalReversedUrl;
      if (reversed) setPreviewReversedUrl(reversed);
      const mockup = logo?.mockupUrl || logo?.horizontalMockupUrl || logo?.verticalMockupUrl;
      if (mockup) setPreviewMockupUrl(mockup);
    }
    window.addEventListener('logo-select', handleLogoEvent);
    window.addEventListener('logo-generated', handleLogoEvent);
    return () => {
      window.removeEventListener('logo-select', handleLogoEvent);
      window.removeEventListener('logo-generated', handleLogoEvent);
    };
  }, []);

  // Derive logo URLs from manifest slots.
  // While manifest is loading, return null (not undefined) so LogoSection can
  // distinguish "still loading" from "no logo" and avoid flashing the CTA.
  const logoUrls = useMemo(() => {
    if (isManifestLoading) return null;

    if (manifestError && !manifest) {
      logger.warn('brandBook.manifest.fetchFailed', { appId, error: String(manifestError) });
      return undefined;
    }

    const primarySlot = manifest?.['logo/primary'];
    if (!primarySlot?.currentUrl && !previewLogoUrl) return undefined;

    const primarySrc = previewLogoUrl || primarySlot?.currentUrl;
    if (!primarySrc) return undefined;

    const reversedSrc = previewLogoUrl
      ? previewReversedUrl || undefined
      : primarySlot?.reversedUrlMap?.[primarySrc];
    const verticalSrc = manifest?.['logo/vertical']?.currentUrl;
    const horizontalSrc = manifest?.['logo/horizontal']?.currentUrl;

    return { primarySrc, reversedSrc, verticalSrc, horizontalSrc };
  }, [manifest, manifestError, isManifestLoading, previewLogoUrl, previewReversedUrl, appId]);

  // Genuine API failure after retries — show error state
  if (error && !data && !isLoading) {
    return (
      <Box inlineAlignChildren="center" blockAlignChildren="center" stretch data-testid="brand-book-error">
        <text.span as="paragraph">Unable to load brand data. Try refreshing the page.</text.span>
      </Box>
    );
  }

  // Loading, or no data yet (agent hasn't written brand data during initial creation)
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="brand-book-loading">
        <text.span as="paragraph">Creating your logo &amp; brand...</text.span>
      </div>
    );
  }

  const palette = data?.palette;

  return (
    <div className={styles.root} style={intentOverrides} data-testid="brand-book-view">
      <HeroSection
        brandName={brandName}
        palette={palette}
      />
      <LogoSection
        brand={brand}
        palette={palette}
        logoUrls={logoUrls}
        isLoading={isGenerating}
      />
      <BrandApplicationsSection
        brand={brand}
        palette={palette}
        mockupUrl={previewMockupUrl}
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
        logoUrl={logoUrls?.primarySrc}
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
