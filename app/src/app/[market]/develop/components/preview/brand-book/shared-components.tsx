'use client';

import Box from '@ux/box';
import text from '@ux/text';

import type { BrandDataPalette } from '@/hooks/useBrandData';
import styles from './brand-book.module.css';
import type { BrandStyle } from './types';

export function Quote({ brand, text: textContent, size = 'md' }: { brand: BrandStyle | undefined; text: string; size?: 'sm' | 'md' | 'lg' }) {
  const fontSize = size === 'lg' ? '1.5rem' : size === 'sm' ? undefined : '1.1rem';
  const Tag = size === 'lg' ? 'h3' : 'p';
  return <Tag className={styles.quote} style={fontSize ? { fontSize } : undefined}><span className={styles.quoteOpen} style={{ color: brand?.primary }}>&ldquo;</span>{textContent}<span
  className={styles.quoteClose} style={{ color: brand?.primary}}>&rdquo;</span></Tag>;
}

export function SectionWrapper({
  children,
  palette,
}: {
  children: React.ReactNode;
  palette?: BrandDataPalette;
}) {
  const sectionStyle: React.CSSProperties | undefined =
    palette?.background && palette?.foreground
      ? { backgroundColor: palette.background, color: palette.foreground }
      : undefined;

  return (
    <>
      <hr className={styles.sectionDivider} />
      <Box
        className={styles.section}
        style={sectionStyle}
      >
        <Box className={styles.sectionInner}>
          {children}
        </Box>
      </Box>
    </>
  );
}

export function SectionHeader({
  num,
  label,
  title,
  brand,
}: {
  num: string;
  label: string;
  title: string;
  brand: BrandStyle;
}) {
  const hasBrand = !!brand.primary;

  return (
    <Box gap="sm">
      <text.h4 size={0.8} as='caption' className={styles.sectionLabel}>
        <span
          style={hasBrand ? { color: brand.primary } : undefined}
        >
          {num}
        </span>
        {' \u2014 '}
        {label}
      </text.h4>
      <text.h2
        as="heading"
        size={0}
        className={styles.sectionHeader}
        text={title}
      />
      <div className={styles.sectionHeaderDivider} style={hasBrand ? {backgroundColor: brand.primary } : undefined }></div>
    </Box>
  );
}

export function Footer({
  brandName,
  brand,
}: {
  brandName: string;
  brand: BrandStyle;
}) {
  const hasBrand = !!brand.primary;

  const footerStyle: React.CSSProperties = hasBrand
    ? { backgroundColor: brand.primary }
    : {};

  return (
    <footer
      style={footerStyle}
    >
      <div className={`${styles.sectionInner} ${styles.footerInner}`}>
        <text.span
          as="caption"
          style={{ color: hasBrand ? brand.primaryFg : undefined }}
        >
          {brandName} &middot; Brand Identity Guide
        </text.span>
      </div>
    </footer>
  );
}
