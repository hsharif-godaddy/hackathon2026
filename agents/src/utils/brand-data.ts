/**
 * Brand Data Types and Parsers
 *
 * Re-exports from brand-data-parsers.ts.
 * The old readBrandData/updateBrandData file I/O functions have been removed —
 * brand data is now assembled from the memory table by the brand-data route.
 */

import type { BrandDataLogo } from './brand-data-parsers.js';

export {
  type BrandData,
  type BrandDataColors,
  type BrandDataPalette,
  type BrandDataTypography,
  type BrandDataLogo,
  type BrandDataLogoVariant,
  type BrandDataPersonality,
  type BrandDataVoice,
  type BrandDataIconography,
  type BrandDataLayout,
  type BrandDataAudience,
  type BrandDataPhotography,
  type BrandDataMission,
  type BrandDataToneMatrix,
  parseBrandPersonality,
  parseBrandVoice,
  extractTagline,
  parseBrandIconography,
  parseBrandLayout,
  parseBrandAudience,
} from './brand-data-parsers.js';

/**
 * Build the brand logo data shape from a processed logo result.
 * Used by generate-logo tool and media skill to save logo data to memory.
 */
export function buildBrandLogoData(logo: {
  transparentUrl?: string;
  solidUrl?: string;
  horizontalTransparentUrl?: string;
  horizontalSolidUrl?: string;
  verticalTransparentUrl?: string;
  verticalSolidUrl?: string;
}): BrandDataLogo {
  return {
    square: {
      transparent: logo.transparentUrl,
      solid: logo.solidUrl,
    },
    horizontal: {
      transparent: logo.horizontalTransparentUrl,
      solid: logo.horizontalSolidUrl,
    },
    vertical: {
      transparent: logo.verticalTransparentUrl,
      solid: logo.verticalSolidUrl,
    },
  };
}
