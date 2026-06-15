/**
 * Design Kit Wizard brand-data accessor.
 *
 * Thin re-export of the shared `useBrandData` hook (`@/hooks/useBrandData`) that
 * `BrandBookView` also uses, so the wizard panels hydrate from the same single
 * `GET /apps/:id/brand-data` fetch and stay in sync with brand-tool updates.
 */
export type {
  BrandData,
  BrandDataAudience,
  BrandDataColors,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataMission,
  BrandDataPalette,
  BrandDataPersonality,
  BrandDataPhotography,
  BrandDataToneMatrix,
  BrandDataTypography,
  BrandDataVoice,
} from '@/hooks/useBrandData';
export { useBrandData, type UseBrandDataOptions } from '@/hooks/useBrandData';
