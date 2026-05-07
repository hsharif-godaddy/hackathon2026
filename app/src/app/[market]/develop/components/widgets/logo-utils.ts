/**
 * Logo data structure
 */
export interface LogoData {
  id: string
  // Square layout URLs
  transparentUrl?: string
  solidUrl?: string
  reversedUrl?: string
  mockupUrl?: string
  // Horizontal layout URLs
  horizontalTransparentUrl?: string
  horizontalSolidUrl?: string
  horizontalReversedUrl?: string
  horizontalMockupUrl?: string
  // Vertical layout URLs
  verticalTransparentUrl?: string
  verticalSolidUrl?: string
  verticalReversedUrl?: string
  verticalMockupUrl?: string
  // V1 Extra Urls when not entitled or deprecated
  watermarkedTransparentUrl?: string
  watermarkedSolidUrl?: string
  url?: string
  // Existing optional fields
  logoFeatures?: {
    logoStyle?: string
    businessDescription?: string
    logoColors?: {
      description?: string
      hexValues?: string[]
    }
  }
  foregroundColor?: string
  backgroundColor?: string
  palette?: string[]
}

/**
 * Get the appropriate logo URL based on entitlement and background preference
 */
export function getLogoDisplayUrl(
  logo: LogoData,
): string | undefined {
  return logo.transparentUrl
    || logo.horizontalTransparentUrl
    || logo.verticalTransparentUrl
    || logo.url
    || logo.watermarkedTransparentUrl
    || logo.solidUrl
    || logo.horizontalSolidUrl
    || logo.verticalSolidUrl
    || logo.watermarkedSolidUrl;
}

export const DEFAULT_LOGO_SLOT_NAME = 'logo/primary';

/**
 * Return all slot names that a logo populates, based on which URL fields are present.
 * Each orientation has its own slot: square → logo/primary, horizontal → logo/horizontal, vertical → logo/vertical.
 * Falls back to ['logo/primary'] when no orientation fields are populated.
 */
export function getLogoSlotNames(logo: LogoData): string[] {
  const slots: string[] = [];
  if (logo.transparentUrl || logo.solidUrl || logo.url || logo.watermarkedTransparentUrl || logo.watermarkedSolidUrl) {
    slots.push('logo/primary');
  }
  if (logo.horizontalTransparentUrl || logo.horizontalSolidUrl) {
    slots.push('logo/horizontal');
  }
  if (logo.verticalTransparentUrl || logo.verticalSolidUrl) {
    slots.push('logo/vertical');
  }
  return slots.length > 0 ? slots : [DEFAULT_LOGO_SLOT_NAME];
}

/**
 * Determine the correct slot name for a logo based on which URL fields are populated.
 * Returns the first (highest-priority) matching slot.
 */
export function getLogoSlotName(logo: LogoData): string {
  return getLogoSlotNames(logo)[0]!;
}
