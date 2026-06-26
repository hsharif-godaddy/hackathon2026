/**
 * Logo data structure
 */
export interface LogoData {
  id: string
  // Square layout URLs
  transparentUrl?: string
  solidUrl?: string
  mockupUrl?: string
  landscapeMockupUrl?: string
  // Horizontal layout URLs
  horizontalTransparentUrl?: string
  horizontalSolidUrl?: string
  horizontalMockupUrl?: string
  horizontalLandscapeMockupUrl?: string
  // Vertical layout URLs
  verticalTransparentUrl?: string
  verticalSolidUrl?: string
  verticalMockupUrl?: string
  verticalLandscapeMockupUrl?: string
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

/**
 * Solid-first URL preference. Use when the logo will render against a light
 * surface and a transparent logo with light strokes would disappear — the
 * solid variant carries its own background.
 */
export function getLogoSolidDisplayUrl(
  logo: LogoData,
): string | undefined {
  return logo.solidUrl
    || logo.horizontalSolidUrl
    || logo.verticalSolidUrl
    || logo.watermarkedSolidUrl
    || logo.transparentUrl
    || logo.horizontalTransparentUrl
    || logo.verticalTransparentUrl
    || logo.url
    || logo.watermarkedTransparentUrl;
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

/**
 * New tool-result shape introduced by the /api/logo/create migration (#4513):
 * a single logo whose URLs are nested per orientation, instead of the legacy
 * flat `LogoData` fields. Defined structurally here because the app does not
 * depend on `@airo/agents` (where the canonical ProcessedLogo/LayoutUrls live).
 */
interface LogoSessionLayoutUrls {
  transparent?: string
  solid?: string
  mockup?: string
  landscapeMockup?: string
}

export interface LogoSessionLogo {
  id: string
  urls?: Partial<Record<'square' | 'horizontal' | 'vertical', LogoSessionLayoutUrls>>
}

/**
 * Adapt the new nested `LogoSessionLogo` shape (#4513) into the flat `LogoData`
 * the chat widget and brand book consume. `palette`/`logoFeatures`/`foregroundColor`
 * are absent on the new shape and intentionally omitted.
 */
export function mapLogoSessionToLogoData(logo: LogoSessionLogo): LogoData {
  const square = logo.urls?.square;
  const horizontal = logo.urls?.horizontal;
  const vertical = logo.urls?.vertical;
  return {
    id: logo.id,
    transparentUrl: square?.transparent,
    solidUrl: square?.solid,
    mockupUrl: square?.mockup,
    landscapeMockupUrl: square?.landscapeMockup,
    horizontalTransparentUrl: horizontal?.transparent,
    horizontalSolidUrl: horizontal?.solid,
    horizontalMockupUrl: horizontal?.mockup,
    horizontalLandscapeMockupUrl: horizontal?.landscapeMockup,
    verticalTransparentUrl: vertical?.transparent,
    verticalSolidUrl: vertical?.solid,
    verticalMockupUrl: vertical?.mockup,
    verticalLandscapeMockupUrl: vertical?.landscapeMockup,
  };
}

/**
 * Normalize a generate_logo / edit_logo tool result into displayable `LogoData[]`,
 * across every shape the tool may emit, in precedence order:
 *   1. New single nested logo — `structuredContent.logo` (#4513)
 *   2. Legacy flat array — `structuredContent.logos`
 *   3. Direct `logos` array
 *   4. MCP `content` resource items → `{ id, url }`
 * Returns `[]` when none are present. Single source of truth for both the chat
 * renderer and the brand-book side-effect, so the shape selection is tested once.
 */
export function extractLogosFromToolResult(resultObj: unknown): LogoData[] {
  if (!resultObj || typeof resultObj !== 'object') return [];
  const obj = resultObj as Record<string, unknown>;
  const structured = obj.structuredContent as Record<string, unknown> | undefined;

  const singleLogo = structured?.logo;
  if (singleLogo && typeof singleLogo === 'object') {
    return [mapLogoSessionToLogoData(singleLogo as LogoSessionLogo)];
  }
  if (Array.isArray(structured?.logos)) {
    return [...(structured!.logos as LogoData[])];
  }
  if (Array.isArray(obj.logos)) {
    return [...(obj.logos as LogoData[])];
  }
  if (Array.isArray(obj.content)) {
    return (obj.content as Array<Record<string, any>>)
      .filter((item) => item?.type === 'resource' && item.resource?.uri)
      .map((item, index) => ({ id: `logo-${index + 1}`, url: item.resource.uri as string }));
  }
  return [];
}
