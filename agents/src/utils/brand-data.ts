/**
 * Brand Data Types and Parsers
 *
 * Re-exports from brand-data-parsers.ts.
 * The old readBrandData/updateBrandData file I/O functions have been removed —
 * brand data is now assembled from the memory table by the brand-data route.
 */

export {
  type BrandData,
  type BrandDataColors,
  type BrandDataPalette,
  type BrandDataTypography,
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
