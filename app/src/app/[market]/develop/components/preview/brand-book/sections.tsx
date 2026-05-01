'use client';

import { Check, X } from 'lucide-react';
import Image from 'next/image';
import { useCallback } from 'react';
import Box from '@ux/box';
import text from '@ux/text';

import type { BrandData, BrandDataPalette } from '@/hooks/useBrandData';
import { logger } from '@/lib/request-context';
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
  logoUrls,
}: {
  brand: BrandStyle;
  palette?: BrandDataPalette;
  logoUrls?: {
    primarySrc?: string;
    reversedSrc?: string;
    verticalSrc?: string;
    horizontalSrc?: string;
  } | null;
}) {
  const lightBg = '#FFFFFF';
  const darkBg = '#1C1C1E';

  const primarySrc = logoUrls?.primarySrc;
  const darkSrc = logoUrls?.reversedSrc || primarySrc;
  const downloadImage = useDownloadImage();

  // null = manifest still loading — render nothing
  if (logoUrls === null) {
    return (
      <SectionWrapper palette={palette}>
        <SectionHeader num="01" label="Primary Mark" title="Logo" brand={brand} />
      </SectionWrapper>
    );
  }

  // undefined = no logo in manifest — show placeholder
  if (logoUrls === undefined) {
    return (
      <SectionWrapper palette={palette}>
        <SectionHeader num="01" label="Primary Mark" title="Logo" brand={brand} />
        <div className={styles.placeholderCard}>
          <text.span as="paragraph" style={{ opacity: 0.5 }}>
            Your logo will appear here once generated.
          </text.span>
        </div>
      </SectionWrapper>
    );
  }

  return (
    <SectionWrapper palette={palette}>
      <SectionHeader num="01" label="Primary Mark" title="Logo" brand={brand} />

      {primarySrc ? (
        <Box gap="lg">
          <div className={styles.logoDualPanel}>
            {/* Light panel */}
            <div className={styles.logoPanelCard}>
              <div className={styles.logoPanelImage} style={{ backgroundColor: lightBg }}>
                <Image
                  src={primarySrc}
                  alt="Logo on light background"
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <div className={styles.logoPanelFooter}>
                <text.span as="caption" style={{ opacity: 0.5 }}>TRANSPARENT / LIGHT</text.span>
                <button type="button" className={styles.downloadButton} onClick={() => downloadImage(primarySrc, 'logo-light.png')}>DOWNLOAD PNG</button>
              </div>
            </div>

            {/* Dark panel */}
            <div className={styles.logoPanelCard}>
              <div className={styles.logoPanelImage} style={{ backgroundColor: darkBg }}>
                <Image
                  src={darkSrc}
                  alt="Logo on dark background"
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <div className={styles.logoPanelFooter}>
                <text.span as="caption" style={{ opacity: 0.5 }}>REVERSED / DARK</text.span>
                <button type="button" className={styles.downloadButton} onClick={() => downloadImage(darkSrc, 'logo-dark.png')}>DOWNLOAD PNG</button>
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
}: {
  palette?: BrandDataPalette;
  brand: BrandStyle;
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
          <text.span as="caption" style={{ opacity: 0.5 }}>
            Your color palette will appear here once generated.
          </text.span>
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
}: {
  palette?: BrandDataPalette;
  brand: BrandStyle;
  logoUrl?: string;
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
                <Image
                  src={logoUrl}
                  alt={`Logo on ${color.name}`}
                  fill
                  unoptimized
                  className={styles.logoImage}
                />
              </div>
              <text.span as="caption" className={styles.colorContextLabel}>
                {color.name.toUpperCase()}
              </text.span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.placeholderCard}>
          <text.span as="caption" style={{ opacity: 0.5 }}>
            Logo on brand colors will appear here once generated.
          </text.span>
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
}: {
  brand: BrandStyle;
  palette?: BrandDataPalette;
  mockupUrl?: string | null;
}) {
  const downloadImage = useDownloadImage();

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
            <button type="button" className={styles.downloadButton} onClick={() => downloadImage(mockupUrl, 'logo-mockup.png')}>Download Mockup</button>
          </div>
        </div>
      ) : (
        <div className={styles.placeholderCard}>
          <text.span as="caption" style={{ opacity: 0.5 }}>
            Your brand mockup will appear here once logos are generated.
          </text.span>
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
}: {
  data: BrandData | null;
  brand: BrandStyle;
  brandName: string;
  palette?: BrandDataPalette;
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
          <text.span as="caption" style={{ opacity: 0.5 }}>
            Your font pairing will appear here once selected.
          </text.span>
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
            <span className={styles.guidelinesDotDo} />
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>DO</text.span>
          </div>
          {doItems.map((item) => (
            <div key={item} className={styles.guidelinesItem}>
              <Check size={14} className={styles.voiceCheckIcon} />
              <text.span as="paragraph" size={0}>{item}</text.span>
            </div>
          ))}
        </div>

        <div className={styles.guidelinesColumn}>
          <div className={styles.guidelinesHeader}>
            <span className={styles.guidelinesDotDont} />
            <text.span as="caption" className={styles.sectionLabel} style={{ fontSize: '0.6rem' }}>DON&apos;T</text.span>
          </div>
          {dontItems.map((item) => (
            <div key={item} className={styles.guidelinesItem}>
              <X size={14} className={styles.voiceCrossIcon} />
              <text.span as="paragraph" size={0}>{item}</text.span>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}

