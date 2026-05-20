'use client';

import { Check, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback } from 'react';
import Box from '@ux/box';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import type { BrandData, BrandDataPalette } from '@/hooks/useBrandData';
import { logger } from '@/lib/request-context';
import { logClickEvent } from '@/utils/instrumentation';
import styles from './brand-book.module.css';
import { SectionHeader, SectionWrapper } from './shared-components';
import type { BrandStyle } from './types';

function useDownloadImage() {
  return useCallback(async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      logger.warn('brandBook.downloadImage.failed', { url, filename, error: error instanceof Error ? error.message : String(error) });
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  HERO                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function HeroSection({
  brandName,
  palette,
}: {
  brandName: string;
  palette?: BrandDataPalette;
}) {
  const bgStyle: React.CSSProperties | undefined =
    palette?.background && palette?.foreground
      ? { backgroundColor: palette.background, color: palette.foreground }
      : undefined;

  return (
    <Box className={styles.hero} style={bgStyle}>
      <div className={styles.heroInner}>
        <span className={styles.heroLabel}>BRAND IDENTITY</span>
        <text.h1
          className={styles.heroTitle}
          as="heading"
          size={2}
        >
          {brandName}
        </text.h1>
        <text.p
          className={styles.heroTagline}
          as="paragraph"
          size={0}
          style={{ opacity: 0.6 }}
        >
          Logo &amp; Brand Guide
        </text.p>
      </div>
    </Box>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  LOGO                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function LogoSection({
  brand,
  palette,
  logoUrl,
  reversedLogoUrl,
  isLoading = false,
}: {
  brand: BrandStyle;
  palette?: BrandDataPalette;
  logoUrl?: string;
  reversedLogoUrl?: string;
  isLoading?: boolean;
}) {
  const downloadImage = useDownloadImage();
  const brandClickProps = { flow: 'logo-designer' as const };

  // null (manifest loading) or undefined (no logo) — show spinner or placeholder
  if (!logoUrl) {
    return (
      <SectionWrapper palette={palette}>
        <SectionHeader num="01" label="Primary Mark" title="Logo" brand={brand} />
        <div className={styles.placeholderCard}>
          {isLoading ? (
            <>
              <Spinner />
              <text.span as="caption" style={{ opacity: 0.5 }}>Generating your logo...</text.span>
            </>
          ) : (
            <text.span as="caption" style={{ opacity: 0.5 }}>
              Your logo will appear here once generated.
            </text.span>
          )}
        </div>
      </SectionWrapper>
    );
  }

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="01" label="Primary Mark" title="Logo" brand={brand} />

      {logoUrl ? (
        <Box gap="lg">
          <div className={styles.logoDualPanel}>
            {/* Light panel — explicit background covers the case where the URL falls back to a transparent variant */}
            <div className={styles.logoPanelCard}>
              <div className={styles.logoPanelImage} style={{ backgroundColor: '#FFFFFF' }}>
                <Image
                  src={logoUrl}
                  alt="Logo on light background"
                  width={0}
                  height={0}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  unoptimized
                  className={styles.logoPanelMedia}
                />
              </div>
              <div className={styles.logoPanelFooter}>
                <text.span as="caption" style={{ opacity: 0.5 }}>SOLID / LIGHT</text.span>
                <button type="button" className={styles.downloadButton} onClick={() => { logClickEvent('develop.brand.logo_download_light', brandClickProps)(); downloadImage(logoUrl, 'logo-light.png'); }}>DOWNLOAD PNG</button>
              </div>
            </div>

            {/* Dark panel — falls back to the light logo when no reversed variant is available */}
            <div className={styles.logoPanelCard}>
              <div className={styles.logoPanelImage} style={{ backgroundColor: '#1C1C1E' }}>
                <Image
                  src={reversedLogoUrl || logoUrl}
                  alt="Logo on dark background"
                  width={0}
                  height={0}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  unoptimized
                  className={styles.logoPanelMedia}
                />
              </div>
              <div className={styles.logoPanelFooter}>
                <text.span as="caption" style={{ opacity: 0.5 }}>REVERSED / DARK</text.span>
                <button type="button" className={styles.downloadButton} onClick={() => { logClickEvent('develop.brand.logo_download_dark', brandClickProps)(); downloadImage(reversedLogoUrl || logoUrl, 'logo-dark.png'); }}>DOWNLOAD PNG</button>
              </div>
            </div>
          </div>

        </Box>
      ) : null}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COLOR PALETTE                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function ColorSection({
  palette,
  brand,
  isLoading = false,
}: {
  palette?: BrandDataPalette;
  brand: BrandStyle;
  isLoading?: boolean;
}) {
  // Prefer displayColors when available; fall back to generic swatches
  const swatches = palette?.displayColors && palette.displayColors.length > 0
    ? palette.displayColors.map((c) => ({
        name: c.name,
        hex: c.hex,
        role: c.role,
      }))
    : palette
      ? [
          { name: 'Primary', hex: palette.primary, role: 'Primary brand color' },
          { name: 'Secondary', hex: palette.secondary, role: 'Secondary brand color' },
          { name: 'Accent', hex: palette.accent, role: 'Accent color' },
          { name: 'Background', hex: palette.background, role: 'Background' },
          { name: 'Foreground', hex: palette.foreground, role: 'Text color' },
        ].filter((c): c is { name: string; hex: string; role: string } => !!c.hex)
      : [];

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader
        num="03"
        label="Brand Colors"
        title="Color Palette"
        brand={brand}
      />

      {swatches.length > 0 ? (
        <div className={styles.swatchGrid}>
          {swatches.map((c) => (
            <div key={c.name} className={styles.swatchCard}>
              <div
                className={styles.swatchSquare}
                style={{ backgroundColor: c.hex }}
              />
              <div className={styles.swatchInfo}>
                <span className={styles.swatchName}>{c.name}</span>
                <span className={styles.swatchValue}>
                  {c.hex.toUpperCase()}
                </span>
                {c.role && (
                  <span className={styles.swatchRole}>{c.role}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.placeholderCard}>
          {isLoading ? (
            <>
              <Spinner />
              <text.span as="caption" style={{ opacity: 0.5 }}>Creating your color palette...</text.span>
            </>
          ) : (
            <text.span as="caption" style={{ opacity: 0.5 }}>
              Your color palette will appear here once generated.
            </text.span>
          )}
        </div>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COLOR CONTEXTS                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function ColorContextsSection({
  palette,
  brand,
  logoUrl,
  isLoading = false,
}: {
  palette?: BrandDataPalette;
  brand: BrandStyle;
  logoUrl?: string;
  isLoading?: boolean;
}) {
  const displayColors = palette?.displayColors;
  const hasData = displayColors && displayColors.length > 0 && logoUrl;

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="04" label="Color Contexts" title="Logo on Brand Colors" brand={brand} />

      {hasData ? (
        <div className={styles.colorContextGrid}>
          {displayColors.map((color) => (
            <div key={color.id} className={styles.colorContextCard}>
              <div className={styles.colorContextSwatch} style={{ backgroundColor: color.hex }}>
                <div className={styles.colorContextLogoInset}>
                  <Image
                    src={logoUrl}
                    alt={`Logo on ${color.name}`}
                    fill
                    unoptimized
                    className={styles.logoImage}
                  />
                </div>
              </div>
              <text.span as="caption" className={styles.colorContextLabel}>
                {color.name.toUpperCase()}
              </text.span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.placeholderCard}>
          {isLoading ? (
            <>
              <Spinner />
              <text.span as="caption" style={{ opacity: 0.5 }}>Preparing color contexts...</text.span>
            </>
          ) : (
            <text.span as="caption" style={{ opacity: 0.5 }}>
              Logo on brand colors will appear here once generated.
            </text.span>
          )}
        </div>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MOCKUP GRID                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function BrandApplicationsSection({
  brand,
  palette,
  mockupUrl,
  isLoading = false,
}: {
  brand: BrandStyle;
  palette?: BrandDataPalette;
  mockupUrl?: string | null;
  isLoading?: boolean;
}) {
  const downloadImage = useDownloadImage();
  const brandClickProps = { flow: 'logo-designer' as const };

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="02" label="Brand Applications" title="Logo on Objects" brand={brand} />

      {mockupUrl ? (
        <div className={styles.mockupPreview}>
          <Image
            src={mockupUrl}
            alt="Brand mockup preview"
            fill
            unoptimized
            className={styles.mockupImage}
          />
          <div className={styles.mockupPreviewFooter}>
            <text.span as="caption" style={{ opacity: 0.5 }}>BRAND MOCKUP PREVIEW</text.span>
            <button type="button" className={styles.downloadButton} onClick={() => { logClickEvent('develop.brand.mockup_download', brandClickProps)(); downloadImage(mockupUrl, 'logo-mockup.png'); }}>Download Mockup</button>
          </div>
        </div>
      ) : (
        <div className={styles.placeholderCard}>
          {isLoading ? (
            <>
              <Spinner />
              <text.span as="caption" style={{ opacity: 0.5 }}>Creating brand mockups...</text.span>
            </>
          ) : (
            <text.span as="caption" style={{ opacity: 0.5 }}>
              Your brand mockup will appear here once logos are generated.
            </text.span>
          )}
        </div>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  TYPOGRAPHY                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function TypographySection({
  data,
  brand,
  brandName,
  palette,
  isLoading = false,
}: {
  data: BrandData | null;
  brand: BrandStyle;
  brandName: string;
  palette?: BrandDataPalette;
  isLoading?: boolean;
}) {
  const typo = data?.typography;

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="05" label="Typography" title="Font Pairing" brand={brand} />

      {typo ? (
        <Box orientation="horizontal" gap="xl">
          <Box gap="md" className={`${styles.softCard} ${styles.fontShowcase} ${styles.flexOne}`} style={{ '--showcase-font': brand.headingFont } as React.CSSProperties}>
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>HEADING FONT</text.span>
            <text.h3 as="heading" size={2}>
              {typo.heading?.family || 'System UI'}
            </text.h3>
            <text.p as="paragraph" style={{ color: brand.primary }}>
              {brandName}
            </text.p>
            {data?.tagline && (
              <text.p as="caption" style={{ opacity: 0.6, fontStyle: 'italic' }}>
                {data.tagline}
              </text.p>
            )}
            <hr className={styles.softDivider} />
            <text.span as="caption">
              Use for: Page titles, section headers, brand name
            </text.span>
          </Box>

          <Box gap="md" className={`${styles.softCard} ${styles.fontShowcase} ${styles.flexOne}`} style={{ '--showcase-font': brand.bodyFont } as React.CSSProperties}>
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>BODY FONT</text.span>
            <text.h3 as="heading" size={2}>
              {typo.body?.family || 'System UI'}
            </text.h3>
            <text.p as="paragraph" size={0} style={{ opacity: 0.85 }}>
              Every detail matters. From the first impression to the lasting memory, your brand speaks through every touchpoint.
            </text.p>
            <hr className={styles.softDivider} />
            <text.span as="caption">
              Use for: Body copy, navigation, captions, UI labels
            </text.span>
          </Box>
        </Box>
      ) : (
        <div className={styles.placeholderCard}>
          {isLoading ? (
            <>
              <Spinner />
              <text.span as="caption" style={{ opacity: 0.5 }}>Selecting your fonts...</text.span>
            </>
          ) : (
            <text.span as="caption" style={{ opacity: 0.5 }}>
              Your font pairing will appear here once selected.
            </text.span>
          )}
        </div>
      )}
    </SectionWrapper>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  USAGE GUIDELINES                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

export function UsageGuidelinesSection({
  palette,
  brand,
}: {
  palette?: BrandDataPalette;
  brand: BrandStyle;
}) {
  const doItems = [
    'Use the transparent PNG on light or dark backgrounds',
    'Maintain minimum size of 80px wide for digital use',
    'Keep clear space around the logo equal to its height',
    'Use on solid brand colors from the approved palette',
    'Use the reversed version on dark backgrounds',
  ];

  const dontItems = [
    'Do not stretch or distort the logo proportions',
    'Do not place on busy, patterned, or photographic backgrounds',
    'Do not use unapproved colors or recolor the logo',
    'Do not add drop shadows, outlines, or effects',
    'Do not use below 80px — use a simplified mark instead',
  ];

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="06" label="Guidelines" title="Logo Usage" brand={brand} />

      <div className={styles.guidelinesGrid}>
        <div className={styles.guidelinesColumn}>
          <div className={styles.guidelinesHeader}>
            <span className={`${styles.guidelinesDot} bg-intents-ux-feedbackSuccess-feedbackColor`} />
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>DO</text.span>
          </div>
          {doItems.map((item) => (
            <div key={item} className={styles.guidelinesItem}>
              <Check size={14} className={`${styles.voiceIcon} text-intents-ux-feedbackSuccess-feedbackColor`} />
              <text.span as="paragraph" size={0}>{item}</text.span>
            </div>
          ))}
        </div>

        <div className={styles.guidelinesColumn}>
          <div className={styles.guidelinesHeader}>
            <span className={`${styles.guidelinesDot} bg-intents-ux-feedbackCritical-feedbackColor`} />
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>DON&apos;T</text.span>
          </div>
          {dontItems.map((item) => (
            <div key={item} className={styles.guidelinesItem}>
              <X size={14} className={`${styles.voiceIcon} text-intents-ux-feedbackCritical-feedbackColor`} />
              <text.span as="paragraph" size={0}>{item}</text.span>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}

