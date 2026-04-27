'use client';

import { useMemo } from 'react';
import Box from '@ux/box';
import text from '@ux/text';

import Tips from '@/app/[market]/develop/components/tips/Tips';
import { useAppName } from '@/hooks/useAppName';
import { useBrandData } from '@/hooks/useBrandData';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import styles from './brand-book.module.css';
import { useBrandIntentOverrides, useBrandStyle, useGoogleFonts, useSuggestPrompt } from './hooks';
import {
  AudienceSection,
  ColorSection,
  HeroSection,
  IconographySection,
  LayoutSection,
  LogoSection,
  MissionSection,
  PersonalitySection,
  PhotographySection,
  ToneMatrixSection,
  TypographySection,
  VoiceSection,
} from './sections';
import { Footer } from './shared-components';
import type { BrandBookViewProps } from './types';

export default function BrandBookView({ appId }: BrandBookViewProps) {
  const { data, isLoading, error } = useBrandData(appId);
  const { data: appName } = useAppName(appId);
  const suggestPrompt = useSuggestPrompt();

  const brandName = data?.brandName || appName || 'Your Brand';
  const tagline = data?.tagline || '';

  // Load Google Fonts for the brand's typography
  useGoogleFonts(data?.typography);

  // Compute derived brand style values (fonts, accent colors)
  const brand = useBrandStyle(data?.palette, data?.typography);

  // Override UXCore intent CSS variables so all child components use brand palette
  const intentOverrides = useBrandIntentOverrides(data?.palette, data?.typography);

  // Read media manifest to get logo slot URLs (single source of truth for logo images)
  const { manifest, isLoading: isManifestLoading } = useMediaManifest({ appId });

  // Derive logo URLs from manifest slots.
  // While manifest is loading, return null (not undefined) so LogoSection can
  // distinguish "still loading" from "no logo" and avoid flashing the CTA.
  const logoUrls = useMemo(() => {
    if (isManifestLoading) return null;

    const primarySlot = manifest?.['logo/primary'];
    if (!primarySlot?.currentUrl) return undefined;

    const primarySrc = primarySlot.currentUrl;
    const verticalSrc = manifest?.['logo/vertical']?.currentUrl;
    const horizontalSrc = manifest?.['logo/horizontal']?.currentUrl;

    return { primarySrc, verticalSrc, horizontalSrc };
  }, [manifest, isManifestLoading]);

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
        <Tips buildingMessage="Creating your brand..." />
      </div>
    );
  }

  const palette = data?.palette;

  return (
    <div className={styles.root} style={intentOverrides} data-testid="brand-book-view">
      <HeroSection
        brandName={brandName}
        tagline={tagline}
        brand={brand}
      />
      <LogoSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        logoUrls={logoUrls}
      />
      <ColorSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        inverted
      />
      <TypographySection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
      />
      <PersonalitySection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        inverted
      />
      <VoiceSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
      />
      <ToneMatrixSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        inverted
      />
      <IconographySection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
      />
      <PhotographySection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        inverted
      />
      <AudienceSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
      />
      <MissionSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
        inverted
      />
      <LayoutSection
        data={data}
        brand={brand}
        onSuggestPrompt={suggestPrompt}
        palette={palette}
      />
      <Footer brandName={brandName} brand={brand} />
    </div>
  );
}
