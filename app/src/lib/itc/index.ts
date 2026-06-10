/**
 * ITC (Internal Tracking Code) Override Module
 *
 * This module provides functionality for overriding default paywall ITCs
 * via URL query parameters. ITCs are used for purchase attribution tracking.
 *
 * Usage:
 * 1. User visits app with `?itc=campaign_code` in URL
 * 2. ItcInitializer component (in root layout) captures and stores the ITC
 * 3. Landing pages may setItcOverride (e.g. via paywall/shared `landingItc`) for campaign LPs
 * 4. Components resolve ITCs via getEffectiveItc() or getItcOverride() ?? itc
 * 5. Stored ITC expires after 24 hours or is replaced by a new URL param
 *
 * @example
 * // In a component that triggers paywall:
 * import { getEffectiveItc } from '@/lib/itc';
 *
 * openUpgradeModal('header.upgrade_button', getEffectiveItc('UPGRADE'));
 */

export { ITC_QUERY_PARAM, ITC_STORAGE_KEY, ITC_TTL_MS } from './constants';
export {
  clearItcOverride,
  getEffectiveItc,
  getItcOverride,
  setItcOverride,
  validateItc,
} from './storage';
