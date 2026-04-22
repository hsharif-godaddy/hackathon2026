'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import type { BrandDataPalette } from '@/hooks/useBrandData';
import styles from './brand-book.module.css';
import type { BrandStyle, SuggestPromptFn } from './types';

export function Quote({ brand, text: textContent, size = 'md' }: { brand: BrandStyle | undefined; text: string; size?: 'sm' | 'md' | 'lg' }) {
  const fontSize = size === 'lg' ? '1.5rem' : size === 'sm' ? undefined : '1.1rem';
  const Tag = size === 'lg' ? 'h3' : 'p';
  return <Tag className={styles.quote} style={fontSize ? { fontSize } : undefined}><span className={styles.quoteOpen} style={{ color: brand?.primary }}>&ldquo;</span>{textContent}<span
  className={styles.quoteClose} style={{ color: brand?.primary}}>&rdquo;</span></Tag>;
}

export function SectionWrapper({
  children,
  inverted,
  palette,
}: {
  children: React.ReactNode;
  inverted?: boolean;
  palette?: BrandDataPalette;
}) {
  const sectionStyle: React.CSSProperties | undefined =
    palette?.background && palette?.foreground
      ? inverted
        ? { backgroundColor: palette.foreground, color: palette.background }
        : { backgroundColor: palette.background, color: palette.foreground }
      : undefined;

  return (
    <Box
      className={styles.section}
      style={sectionStyle}
    >
      <Box className={styles.sectionInner}>
        {children}
      </Box>
    </Box>
  );
}

export function SectionPlaceholder({
  description,
  prompt,
  onSuggestPrompt,
}: {
  description: string;
  prompt: string;
  onSuggestPrompt: SuggestPromptFn;
}) {
  return (
    <Box
      orientation="vertical"
      gap="md"
      blockPadding="lg"
      inlinePadding="lg"
      inlineAlignChildren="center"
      className={styles.softCard}
    >
      <text.p as="caption" style={{ opacity: 0.6 }}>{description}</text.p>
      <Button design="secondary" onClick={() => onSuggestPrompt(prompt)}>
        Generate this section
      </Button>
    </Box>
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
        size={1}
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
