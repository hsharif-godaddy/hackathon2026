'use client';

import { useEffect, useMemo } from 'react';
import Intents, { toCssCustomProperty } from '@ux/intents';

import type { BrandDataPalette, BrandDataTypography } from '@/hooks/useBrandData';
import { extractVarName,fontFamily, getContrastColor } from './helpers';
import type { BrandStyle } from './types';

/** Loads Google Fonts for the brand's heading and body families. */
export function useGoogleFonts(typo: BrandDataTypography | undefined) {
  useEffect(() => {
    if (!typo) return;

    const entries: { family: string; weights: string[] }[] = [];
    if (typo.heading?.family) {
      entries.push({ family: typo.heading.family, weights: typo.heading.weights ?? [] });
    }
    if (typo.body?.family) {
      entries.push({ family: typo.body.family, weights: typo.body.weights ?? [] });
    }
    if (entries.length === 0) return;

    const DEFAULT_WEIGHTS = ['400', '500', '600', '700'];
    const params = entries
      .map(({ family, weights }) => {
        const safeWeights = weights.filter(w => /^\d+$/.test(String(w)));
        const w = safeWeights.length > 0 ? safeWeights : DEFAULT_WEIGHTS;
        return `family=${encodeURIComponent(family)}:wght@${w.join(';')}`;
      })
      .join('&');

    const href = `https://fonts.googleapis.com/css2?${params}&display=swap`;

    // Deduplicate: skip if a <link> with this exact href already exists
    const existing = document.querySelector(`link[href="${CSS.escape(href)}"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);

    return () => {
      link.parentNode?.removeChild(link);
    };
  }, [typo]);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  UXCore intent overrides                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

// Module-level singleton — created once, reused across renders.
// Safe at module scope: Intents is a pure lookup class with no side effects, no DOM access,
// and no mutable state. It only maps intent paths to CSS custom property names.
// Cast required: @ux/intents ships no .d.ts type declarations.
const uxIntents = new (Intents as any)();

/**
 * Builds a CSS custom property override map so UXCore components inside the
 * brand book automatically use the brand's palette and fonts.
 */
export function useBrandIntentOverrides(
  palette: BrandDataPalette | undefined,
  typo: BrandDataTypography | undefined,
): React.CSSProperties {
  return useMemo(() => {
    if (!palette) return {};
    const overrides: Record<string, string> = {};

    const set = (intentProp: string, value: string | undefined) => {
      if (!value) return;
      const varName = extractVarName(intentProp);
      if (varName) overrides[varName] = value;
    };

    const ix = uxIntents.ux;
    const primaryFg = palette.primaryForeground || (palette.primary ? getContrastColor(palette.primary) : undefined);
    const secondaryFg = palette.secondaryForeground || (palette.secondary ? getContrastColor(palette.secondary) : undefined);

    // Action intents — primary buttons
    set(ix.actionPrimary.backgroundColor, palette.primary);
    set(ix.actionPrimary.foregroundColor, primaryFg);
    set(ix.actionPrimary.borderColor, palette.primary);

    // Action intents — secondary buttons (use primary color for text/border, transparent bg)
    set(ix.actionSecondary.foregroundColor, palette.primary);
    set(ix.actionSecondary.borderColor, palette.primary);

    // Box intents — containers
    set(ix.box.backgroundColor, palette.background);
    set(ix.box.foregroundColor, palette.foreground);
    set(ix.box.borderColor, palette.border);
    set(ix.boxHighContrast.backgroundColor, palette.foreground);
    set(ix.boxHighContrast.foregroundColor, palette.background);
    set(ix.boxLowContrast.backgroundColor, palette.muted);

    // Feedback intents — semantic colors
    set(ix.feedbackCritical.feedbackColor, palette.destructive);
    set(ix.feedbackCritical.onFeedbackColor, palette.destructiveForeground);
    set(ix.feedbackSuccess.feedbackColor, palette.success);
    set(ix.feedbackSuccess.onFeedbackColor, palette.successForeground);
    set(ix.feedbackWarning.feedbackColor, palette.warning);
    set(ix.feedbackWarning.onFeedbackColor, palette.warningForeground);

    // Map feedbackInfo → secondary (for branded tags)
    set(ix.feedbackInfo.feedbackColor, palette.secondary);
    set(ix.feedbackInfo.onFeedbackColor, secondaryFg);

    // Navigation intents
    set(ix.navigate.foregroundColor, palette.primary);
    set(ix.navigatePrimary.foregroundColor, palette.primary);

    // Figure intents — chart/data viz colors
    if (palette.chart1) set(ix.figure.figureColor0, palette.chart1);
    if (palette.chart2) set(ix.figure.figureColor1, palette.chart2);
    if (palette.chart3) set(ix.figure.figureColor2, palette.chart3);
    if (palette.chart4) set(ix.figure.figureColor3, palette.chart4);
    if (palette.chart5) set(ix.figure.figureColor4, palette.chart5);

    // Typography intents — heading fonts (global + local @ux/text intents)
    const headingFont = fontFamily(typo?.heading?.family);
    const bodyFont = fontFamily(typo?.body?.family);

    // Global theme intents
    set(ix.textHeading.fontFamily, headingFont);
    set(ix.textTitle.fontFamily, headingFont);
    set(ix.text.fontFamily, bodyFont);
    set(ix.textParagraph.fontFamily, bodyFont);
    set(ix.textAction.fontFamily, bodyFont);
    set(ix.textCaption.fontFamily, bodyFont);
    set(ix.textLabel.fontFamily, bodyFont);
    set(ix.textInput.fontFamily, bodyFont);

    // Local @ux/text component intents (separate hashed CSS vars from global ones;
    // the theme sets these directly, so we must override them too)
    const setLocal = (intentPath: string, value: string | undefined) => {
      if (!value) return;
      // toCssCustomProperty returns the hashed var name like "--ux-abc123"
      const varName = (toCssCustomProperty as (p: string) => string)(intentPath);
      if (varName) overrides[varName] = value;
    };

    setLocal('uxText.fontFamily', bodyFont);
    setLocal('uxText.heading.fontFamily', headingFont);
    setLocal('uxText.title.fontFamily', headingFont);
    setLocal('uxText.paragraph.fontFamily', bodyFont);
    setLocal('uxText.action.fontFamily', bodyFont);
    setLocal('uxText.caption.fontFamily', bodyFont);
    setLocal('uxText.input.fontFamily', bodyFont);
    setLocal('uxText.label.fontFamily', bodyFont);

    return overrides as React.CSSProperties;
  }, [palette, typo]);
}

export function useBrandStyle(
  palette: BrandDataPalette | undefined,
  typo: BrandDataTypography | undefined,
): BrandStyle {
  return useMemo(() => {
    const primaryFg =
      palette?.primaryForeground || (palette?.primary ? getContrastColor(palette.primary) : undefined);

    return {
      headingFont: fontFamily(typo?.heading?.family),
      bodyFont: fontFamily(typo?.body?.family),
      primary: palette?.primary,
      primaryFg,
    };
  }, [palette, typo]);
}
