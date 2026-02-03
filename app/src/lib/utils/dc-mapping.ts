import { logger } from '@/lib/request-context';

/**
 * Country code to continent code mapping
 *
 * Maps ISO 3166-1 alpha-2 country codes to continent codes.
 * Used internally by getDatacenterFromMarketId to determine geographic region.
 */
const continentsByCountryCodes: Record<string, string> = {
  A1: 'NA',
  A2: 'NA',
  AD: 'EU',
  AE: 'AS',
  AF: 'AS',
  AG: 'NA',
  AI: 'NA',
  AL: 'EU',
  AM: 'AS',
  AN: 'NA',
  AO: 'AF',
  AP: 'AS',
  AQ: 'AN',
  AR: 'SA',
  AS: 'OC',
  AT: 'EU',
  AU: 'OC',
  AW: 'NA',
  AX: 'EU',
  AZ: 'AS',
  BA: 'EU',
  BB: 'NA',
  BD: 'AS',
  BE: 'EU',
  BF: 'AF',
  BG: 'EU',
  BH: 'AS',
  BI: 'AF',
  BJ: 'AF',
  BL: 'NA',
  BM: 'NA',
  BN: 'AS',
  BO: 'SA',
  BR: 'SA',
  BS: 'NA',
  BT: 'AS',
  BV: 'AN',
  BW: 'AF',
  BY: 'EU',
  BZ: 'NA',
  CA: 'NA',
  CC: 'AS',
  CD: 'AF',
  CF: 'AF',
  CG: 'AF',
  CH: 'EU',
  CI: 'AF',
  CK: 'OC',
  CL: 'SA',
  CM: 'AF',
  CN: 'AS',
  CO: 'SA',
  CR: 'NA',
  CU: 'NA',
  CV: 'AF',
  CX: 'AS',
  CY: 'AS',
  CZ: 'EU',
  DE: 'EU',
  DJ: 'AF',
  DK: 'EU',
  DM: 'NA',
  DO: 'NA',
  DZ: 'AF',
  EC: 'SA',
  EE: 'EU',
  EG: 'AF',
  EH: 'AF',
  ER: 'AF',
  ES: 'EU',
  ET: 'AF',
  EU: 'EU',
  FI: 'EU',
  FJ: 'OC',
  FK: 'SA',
  FM: 'OC',
  FO: 'EU',
  FR: 'EU',
  FX: 'EU',
  GA: 'AF',
  GB: 'EU',
  GD: 'NA',
  GE: 'AS',
  GF: 'SA',
  GG: 'EU',
  GH: 'AF',
  GI: 'EU',
  GL: 'NA',
  GM: 'AF',
  GN: 'AF',
  GP: 'NA',
  GQ: 'AF',
  GR: 'EU',
  GS: 'AN',
  GT: 'NA',
  GU: 'OC',
  GW: 'AF',
  GY: 'SA',
  HK: 'AS',
  HM: 'AN',
  HN: 'NA',
  HR: 'EU',
  HT: 'NA',
  HU: 'EU',
  ID: 'AS',
  IE: 'EU',
  IL: 'AS',
  IM: 'EU',
  IN: 'AS',
  IO: 'AS',
  IQ: 'AS',
  IR: 'AS',
  IS: 'EU',
  IT: 'EU',
  JE: 'EU',
  JM: 'NA',
  JO: 'AS',
  JP: 'AS',
  KE: 'AF',
  KG: 'AS',
  KH: 'AS',
  KI: 'OC',
  KM: 'AF',
  KN: 'NA',
  KP: 'AS',
  KR: 'AS',
  KW: 'AS',
  KY: 'NA',
  KZ: 'AS',
  LA: 'AS',
  LB: 'AS',
  LC: 'NA',
  LI: 'EU',
  LK: 'AS',
  LR: 'AF',
  LS: 'AF',
  LT: 'EU',
  LU: 'EU',
  LV: 'EU',
  LY: 'AF',
  MA: 'AF',
  MC: 'EU',
  MD: 'EU',
  ME: 'EU',
  MF: 'NA',
  MG: 'AF',
  MH: 'OC',
  MK: 'EU',
  ML: 'AF',
  MM: 'AS',
  MN: 'AS',
  MO: 'AS',
  MP: 'OC',
  MQ: 'NA',
  MR: 'AF',
  MS: 'NA',
  MT: 'EU',
  MU: 'AF',
  MV: 'AS',
  MW: 'AF',
  MX: 'NA',
  MY: 'AS',
  MZ: 'AF',
  NA: 'AF',
  NC: 'OC',
  NE: 'AF',
  NF: 'OC',
  NG: 'AF',
  NI: 'NA',
  NL: 'EU',
  NO: 'EU',
  NP: 'AS',
  NR: 'OC',
  NU: 'OC',
  NZ: 'OC',
  O1: 'NA',
  OM: 'AS',
  PA: 'NA',
  PE: 'SA',
  PF: 'OC',
  PG: 'OC',
  PH: 'AS',
  PK: 'AS',
  PL: 'EU',
  PM: 'NA',
  PN: 'OC',
  PR: 'NA',
  PS: 'AS',
  PT: 'EU',
  PW: 'OC',
  PY: 'SA',
  QA: 'AS',
  RE: 'AF',
  RO: 'EU',
  RS: 'EU',
  RU: 'EU',
  RW: 'AF',
  SA: 'AS',
  SB: 'OC',
  SC: 'AF',
  SD: 'AF',
  SE: 'EU',
  SG: 'AS',
  SH: 'AF',
  SI: 'EU',
  SJ: 'EU',
  SK: 'EU',
  SL: 'AF',
  SM: 'EU',
  SN: 'AF',
  SO: 'AF',
  SR: 'SA',
  ST: 'AF',
  SV: 'NA',
  SY: 'AS',
  SZ: 'AF',
  TC: 'NA',
  TD: 'AF',
  TF: 'AN',
  TG: 'AF',
  TH: 'AS',
  TJ: 'AS',
  TK: 'OC',
  TL: 'AS',
  TM: 'AS',
  TN: 'AF',
  TO: 'OC',
  TR: 'EU',
  TT: 'NA',
  TV: 'OC',
  TW: 'AS',
  TZ: 'AF',
  UA: 'EU',
  UG: 'AF',
  UM: 'OC',
  US: 'NA',
  UY: 'SA',
  UZ: 'AS',
  VA: 'EU',
  VC: 'NA',
  VE: 'SA',
  VG: 'NA',
  VI: 'NA',
  VN: 'AS',
  VU: 'OC',
  WF: 'OC',
  WS: 'OC',
  YE: 'AS',
  YT: 'AF',
  ZA: 'AF',
  ZM: 'AF',
  ZW: 'AF',
};

const continentCode: Record<string, { name: string; dc: string }> = {
  OC: { name: 'australia', dc: 'p3' },
  EU: { name: 'europe', dc: 'sxb1' },
  AS: { name: 'asia', dc: 'sxb1' },
  AF: { name: 'africa', dc: 'sxb1' },
  SA: { name: 'south-america', dc: 'p3' },
  NA: { name: 'north-america', dc: 'p3' },
};

const DEFAULT_DATACENTER = 'p3';

/**
 * Get datacenter from marketId (locale string)
 *
 * Determines the optimal datacenter based on the user's locale/market.
 * The marketId is expected to come from Gasket's detectLocale() which returns
 * well-formed BCP 47 locale strings (e.g., 'en-US', 'de-DE', 'fr-FR').
 *
 * **Input Format Expectations:**
 * - Format: `{language}-{COUNTRY}` (e.g., 'en-US', 'de-DE', 'pt-BR')
 * - The marketId comes from Gasket's locale detection which validates/normalizes
 *   the locale before returning it, so we trust the format is correct
 * - If a malformed or unexpected format is passed, the function gracefully
 *   falls back to the default datacenter (p3) - this is by design
 *
 * **Datacenter Selection:**
 * - North America, South America, Oceania → p3
 * - Europe, Asia, Africa → sxb1
 * - Unknown/malformed → p3 (default)
 *
 * @param marketId - Locale string from Gasket's detectLocale() (e.g., 'en-US', 'de-DE')
 * @returns Datacenter code ('sxb1' or 'p3')
 *
 * @example
 * getDatacenterFromMarketId('en-US')  // Returns 'p3' (North America)
 * getDatacenterFromMarketId('de-DE')  // Returns 'sxb1' (Europe)
 * getDatacenterFromMarketId('ja-JP')  // Returns 'sxb1' (Asia)
 * getDatacenterFromMarketId(undefined) // Returns 'p3' (default)
 * getDatacenterFromMarketId('invalid') // Returns 'p3' (graceful fallback)
 */
function getDatacenterFromMarketId(marketId?: string): string {
  if (!marketId) {
    logger.info('dc-mapping.select.default', {
      reason: 'no-market-id',
      datacenter: DEFAULT_DATACENTER
    });
    return DEFAULT_DATACENTER;
  }

  // Extract country code from marketId (e.g., 'en-US' -> 'US')
  // We trust the format from Gasket's detectLocale(), but handle edge cases gracefully
  const country = marketId.toUpperCase().substring(3, 5);

  // Look up continent from country code
  const continent = continentsByCountryCodes[country];
  if (!continent) {
    logger.info('dc-mapping.select.default', {
      marketId,
      country,
      reason: 'unknown-country',
      datacenter: DEFAULT_DATACENTER
    });
    return DEFAULT_DATACENTER;
  }

  // Look up datacenter from continent
  const continentInfo = continentCode[continent];
  if (!continentInfo) {
    logger.info('dc-mapping.select.default', {
      marketId,
      country,
      continent,
      reason: 'unknown-continent',
      datacenter: DEFAULT_DATACENTER
    });
    return DEFAULT_DATACENTER;
  }

  logger.info('dc-mapping.select.success', {
    marketId,
    country,
    continent,
    continentName: continentInfo.name,
    datacenter: continentInfo.dc
  });

  return continentInfo.dc;
}

export { continentsByCountryCodes, continentCode, getDatacenterFromMarketId };
