/**
 * diffBusinessInfo — Google Business Profile sync skill
 *
 * Compares the GBP listing (from getGbpProfile) against the site's business
 * info (from getSiteBusinessInfo) field-by-field and returns per-field
 * mismatch records. Agent-side only — the agent threads the two prior tool
 * outputs in as parameters, keeping this comparator pure and testable.
 *
 * Comparison strategy per field:
 * - name:    trim + case-insensitive equality
 * - phone:   E.164-ish normalization (last 10 digits), then equality
 * - website: lowercase host + strip trailing slash, then equality
 * - address: if the site has structured JSON-LD PostalAddress → field-by-field;
 *            else LLM equivalence between the GBP address and the site's free text
 * - hours:   if the site has structured JSON-LD openingHoursSpecification →
 *            canonical day/time comparison vs GBP regularHours; else LLM equivalence
 *
 * Every LLM equivalence call logs a decision record (inputA, inputB, verdict,
 * rationale) and defaults to "different" on low confidence or error, so an
 * uncertain judgment forces the user to choose rather than silently matching.
 */

import { llmMetadataContext } from '@airo/ai-common';
import { getModel } from '@airo/ai-lib';
import { generateObject } from 'ai';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { ContextAttachment } from '@airo/shared/context-attachment';
import type { GoogleBusinessProfile } from '@airo/shared/social';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { MemoryRepository } from '../../../database/repositories/MemoryRepository.js';
import { GBP_PROFILE_READY } from '../../../types/social.js';
import { readSiteBusinessInfo } from './get-site-business-info.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'google-business-profile-sync-skill' });
const memoryRepo = new MemoryRepository();

/** Below this model-reported confidence, an equivalence verdict is treated as "different". */
const EQUIVALENCE_CONFIDENCE_FLOOR = 0.7;

export type DiffField = 'name' | 'phone' | 'address' | 'hours' | 'website' | 'description';
export type DiffStrategy = 'normalized' | 'jsonld-structured' | 'llm-equivalence' | 'presence';

/** Which side(s) have a value for a field. 'gbp-only'/'site-only' are themselves mismatches. */
export type FieldPresence = 'both' | 'gbp-only' | 'site-only';

export interface FieldDiff {
  field: DiffField;
  gbp: string | null;
  site: string | null;
  equivalent: boolean;
  strategy: DiffStrategy;
  presence: FieldPresence;
  rationale?: string;
}

/**
 * When exactly one side has a value, that IS a mismatch (the listing/site is missing
 * info the other has) — surface it instead of dropping the field. Returns null only
 * when neither side has a value (nothing to reconcile) or both do (caller compares).
 */
function presenceDiff(field: DiffField, gbp: string | null, site: string | null): FieldDiff | null {
  if (gbp && !site) {
    return { field, gbp, site: null, equivalent: false, strategy: 'presence', presence: 'gbp-only' };
  }
  if (!gbp && site) {
    return { field, gbp: null, site, equivalent: false, strategy: 'presence', presence: 'site-only' };
  }
  return null;
}

// --- normalization helpers (pure; exported for unit testing) ---

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Canonicalize a phone string to E.164 for cross-format comparison. `country` (a
 * CLDR region code, e.g. from the GBP listing's storefrontAddress.regionCode) lets
 * libphonenumber parse a national-format number ("020 7946 0958" + "GB" →
 * "+442079460958"), so a site's local formatting compares equal to GBP's. Falls
 * back to bare digits (dropping a NANP "+1") when the number can't be parsed — the
 * degenerate no-country case where two un-parseable values still compare by digits.
 */
export function normalizePhone(value: string, country?: string): string {
  const parsed = parsePhoneNumberFromString(value, country as CountryCode | undefined);
  if (parsed) {
    return parsed.number;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/** Common US street-address abbreviations → full word, for deterministic address equality. */
const ADDRESS_TOKEN_ALIASES: Record<string, string> = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', rd: 'road',
  dr: 'drive', ln: 'lane', ct: 'court', cir: 'circle', pl: 'place', sq: 'square', ter: 'terrace',
  hwy: 'highway', pkwy: 'parkway', ste: 'suite', apt: 'apartment', bldg: 'building', fl: 'floor', rm: 'room',
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

/**
 * Canonicalize an address string for equality: normalize case/space, drop punctuation,
 * then expand common abbreviations (St→Street, Ave→Avenue, Ste→Suite, N→North …) so the
 * frequent "123 Main St" vs "123 Main Street" case matches WITHOUT an LLM call.
 */
export function canonicalizeAddress(value: string): string {
  return normalizeName(value)
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ADDRESS_TOKEN_ALIASES[token] ?? token)
    .join(' ');
}

/** Lowercase host, drop protocol/`www.`, strip trailing slash, for URL equality. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.host.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

const DAY_ORDER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function dayKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  // schema.org allows "https://schema.org/Monday"; GBP uses "MONDAY".
  const segment = value.split('/').pop() ?? value;
  return segment.trim().slice(0, 3).toUpperCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function schemaTimeToHHMM(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return `${pad2(Number(match[1]))}${match[2]}`;
}

function gbpTimeToHHMM(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const time = value as { hours?: number; minutes?: number };
  if (typeof time.hours !== 'number') {
    return null;
  }
  return `${pad2(time.hours)}${pad2(time.minutes ?? 0)}`;
}

/** Canonical, comparable hours signature: sorted "DAY HHMM-HHMM" lines. */
export function canonicalizeGbpHours(regularHours: unknown): string {
  const periods = (regularHours as { periods?: unknown[] } | null)?.periods;
  if (!Array.isArray(periods)) {
    return '';
  }
  const lines: string[] = [];
  for (const p of periods) {
    const period = p as { openDay?: unknown; openTime?: unknown; closeDay?: unknown; closeTime?: unknown };
    const day = dayKey(period.openDay);
    const closeDay = dayKey(period.closeDay);
    const open = gbpTimeToHHMM(period.openTime);
    const close = gbpTimeToHHMM(period.closeTime);
    if (day && open && close) {
      // A close on a later day at/after the open time (e.g. MON 09:00 → TUE 09:00) is NOT
      // the implicit overnight that `close < open` already encodes (MON 20:00 → TUE 02:00,
      // canonicalized as "MON 2000-0200" to match schema.org's same-day-with-wraparound
      // form). Make the genuine next-day close explicit so it isn't conflated with a
      // same-day period of identical clock times.
      const explicitNextDay = closeDay !== null && closeDay !== day && close >= open;
      lines.push(explicitNextDay ? `${day} ${open}-${closeDay} ${close}` : `${day} ${open}-${close}`);
    }
  }
  return sortHourLines(lines);
}

export function canonicalizeSchemaHours(openingHours: unknown): string {
  if (!Array.isArray(openingHours)) {
    return '';
  }
  const lines: string[] = [];
  for (const spec of openingHours) {
    const entry = spec as { dayOfWeek?: unknown; opens?: unknown; closes?: unknown };
    const open = schemaTimeToHHMM(entry.opens);
    const close = schemaTimeToHHMM(entry.closes);
    if (!open || !close) {
      continue;
    }
    const days = Array.isArray(entry.dayOfWeek) ? entry.dayOfWeek : [entry.dayOfWeek];
    for (const d of days) {
      const day = dayKey(d);
      if (day) {
        lines.push(`${day} ${open}-${close}`);
      }
    }
  }
  return sortHourLines(lines);
}

function sortHourLines(lines: string[]): string {
  return [...new Set(lines)]
    .sort((a, b) => {
      const da = DAY_ORDER.indexOf(a.slice(0, 3));
      const db = DAY_ORDER.indexOf(b.slice(0, 3));
      return da !== db ? da - db : a.localeCompare(b);
    })
    .join('; ');
}

// --- display formatting (human-readable, also fed to the LLM comparator) ---

export function formatGbpAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') {
    return null;
  }
  const a = address as {
    addressLines?: unknown;
    locality?: unknown;
    administrativeArea?: unknown;
    postalCode?: unknown;
  };
  const lines = Array.isArray(a.addressLines) ? a.addressLines.filter((l): l is string => typeof l === 'string') : [];
  const tail = [a.locality, a.administrativeArea, a.postalCode].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  const parts = [...lines, tail.join(' ')].filter((p) => p.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

export function formatSchemaAddress(address: unknown): string | null {
  if (typeof address === 'string') {
    return address.trim() || null;
  }
  if (!address || typeof address !== 'object') {
    return null;
  }
  const a = address as {
    streetAddress?: unknown;
    addressLocality?: unknown;
    addressRegion?: unknown;
    postalCode?: unknown;
  };
  const tail = [a.addressLocality, a.addressRegion, a.postalCode].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  const parts = [a.streetAddress, tail.join(' ')].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

export function formatGbpHours(regularHours: unknown): string | null {
  const canonical = canonicalizeGbpHours(regularHours);
  return canonical || null;
}

// --- text-blob field extraction (extractKeyContent output, JSON-LD-absent path) ---

/** Pull a labeled value from the extractKeyContent blob, e.g. "Phone: (555) 123-4567". */
export function fieldFromBlob(blob: string, label: 'Phone' | 'Email' | 'Address' | 'Location' | 'Description'): string | null {
  // Plain string scan (no dynamic RegExp): find "Label:" and take the rest of that line.
  const marker = `${label}:`;
  const start = blob.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const rest = blob.slice(start + marker.length);
  const lineEnd = rest.indexOf('\n');
  const value = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim();
  return value || null;
}

/** Collect the hours lines that follow the "Hours:" marker in the blob. */
export function hoursFromBlob(blob: string): string | null {
  const idx = blob.indexOf('Hours:');
  if (idx === -1) {
    return null;
  }
  const after = blob.slice(idx + 'Hours:'.length);
  const lines = after
    .split('\n')
    .map((l) => l.replace(/^[\s-]+/, '').trim())
    .filter((l) => l !== '');
  const collected: string[] = [];
  for (const line of lines) {
    if (/[A-Z][a-z]+ INFORMATION|SECTION|FOUND|STATEMENTS/.test(line)) {
      break;
    }
    collected.push(line);
    if (collected.length >= 7) {
      break;
    }
  }
  return collected.length > 0 ? collected.join('; ') : null;
}

// --- LLM equivalence ---

const equivalenceSchema = z.object({
  equivalent: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

const EQUIVALENCE_SYSTEM_PROMPT =
  'You compare two representations of the same business field (an address, opening hours, ' +
  'or a business description) and decide whether they describe the SAME real-world value ' +
  'despite formatting or wording differences. ' +
  'Address/hours examples of equivalent: "Mon-Fri 9-5" vs "Monday to Friday 9:00 AM - 5:00 PM"; ' +
  '"123 Main St" vs "123 Main Street". Different street numbers, cities, added/removed suites, ' +
  'or different days/times are NOT equivalent. ' +
  'For a description: equivalent when both describe the same business with consistent facts ' +
  '(services, specialties, location), even if the wording, length, or tone differ — a GBP ' +
  'blurb and a site meta/SEO description rarely match word-for-word. NOT equivalent only when ' +
  'they assert CONFLICTING facts (different services, location, or claims). ' +
  'Report your confidence in [0,1]. When unsure, set equivalent=false.';

interface EquivalenceVerdict {
  equivalent: boolean;
  rationale: string;
}

async function judgeEquivalence(field: DiffField, gbpValue: string, siteValue: string): Promise<EquivalenceVerdict> {
  try {
    const model = await getModel('haiku');
    const metadata = {
      user: 'airo-builder:gbp-sync-equivalence',
      tags: ['source:tool-llm', 'source:gbp-sync-equivalence'],
    };
    const prompt = `Field: ${field}\nGBP value:\n${gbpValue}\n\nSite value:\n${siteValue}`;

    const { object } = await llmMetadataContext.run(metadata, () =>
      generateObject({
        model,
        schema: equivalenceSchema,
        schemaName: 'business_field_equivalence',
        system: EQUIVALENCE_SYSTEM_PROMPT,
        prompt,
        maxOutputTokens: 200,
        experimental_telemetry: { isEnabled: true, functionId: 'gbp-sync-equivalence' },
      })
    );

    // Low-confidence verdicts collapse to "different" so the user is asked to choose.
    const equivalent = object.equivalent && object.confidence >= EQUIVALENCE_CONFIDENCE_FLOOR;

    logger.info('google-business-profile-sync.diff.equivalence', {
      field,
      inputA: gbpValue,
      inputB: siteValue,
      verdict: equivalent,
      modelEquivalent: object.equivalent,
      confidence: object.confidence,
      rationale: object.rationale,
    });

    return { equivalent, rationale: object.rationale };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('google-business-profile-sync.diff.equivalence-error', { field, error });
    // Fail safe: treat as a mismatch so the user is prompted rather than silently skipped.
    return { equivalent: false, rationale: `Could not verify automatically (${error}); treating as different.` };
  }
}

// --- tool ---

const gbpInputSchema = z.object({
  name: z.string().optional(),
  primaryPhone: z.string().optional(),
  websiteUri: z.string().optional(),
  description: z.string().optional(),
  storefrontAddress: z.record(z.string(), z.unknown()).optional(),
  regularHours: z.record(z.string(), z.unknown()).optional(),
});

const siteInputSchema = z.object({
  jsonLd: z.record(z.string(), z.unknown()).nullable().optional(),
  textBlob: z.string().optional(),
});

type GbpInput = z.infer<typeof gbpInputSchema>;
type SiteInput = z.infer<typeof siteInputSchema>;

/**
 * Pull the GBP profile from the most recent GBP_PROFILE_READY context attachment
 * (posted by the frontend during getGbpProfile's round-trip, present for the rest
 * of that turn). Lets diff self-source the listing instead of the model threading
 * it back as a parameter.
 */
function readGbpFromContext(ctx: AgentsAppContext): GbpInput | null {
  const attachments = ctx?.contextAttachments;
  if (!Array.isArray(attachments)) {
    return null;
  }
  const matching = attachments.filter(
    (att): att is ContextAttachment<{ profile: GoogleBusinessProfile }> => att.type === GBP_PROFILE_READY
  );
  const latest = matching[matching.length - 1];
  return (latest?.data?.profile as GbpInput | undefined) ?? null;
}

function compareName(gbp: GbpInput, site: SiteInput): FieldDiff | null {
  const gbpName = gbp.name?.trim() || null;
  const siteName = (typeof site.jsonLd?.name === 'string' ? site.jsonLd.name.trim() : '') || null;
  if (!gbpName || !siteName) {
    return presenceDiff('name', gbpName, siteName);
  }
  return {
    field: 'name',
    gbp: gbpName,
    site: siteName,
    equivalent: normalizeName(gbpName) === normalizeName(siteName),
    strategy: 'normalized',
    presence: 'both',
  };
}

async function compareDescription(gbp: GbpInput, site: SiteInput): Promise<FieldDiff | null> {
  const gbpDesc = gbp.description?.trim() || null;
  const siteDesc =
    (typeof site.jsonLd?.description === 'string' ? site.jsonLd.description.trim() : '') ||
    (site.textBlob ? fieldFromBlob(site.textBlob, 'Description') : null);
  if (!gbpDesc || !siteDesc) {
    return presenceDiff('description', gbpDesc, siteDesc);
  }
  // GBP's description and the site's meta/JSON-LD description are written for different
  // surfaces and are almost always worded differently for the same business — so compare
  // by MEANING (LLM), not exact text. Only conflicting facts (different services, location,
  // claims) should flag; mere rephrasing/length/tone differences are equivalent.
  const verdict = await judgeEquivalence('description', gbpDesc, siteDesc);
  return {
    field: 'description',
    gbp: gbpDesc,
    site: siteDesc,
    equivalent: verdict.equivalent,
    strategy: 'llm-equivalence',
    presence: 'both',
    rationale: verdict.rationale,
  };
}

function comparePhone(gbp: GbpInput, site: SiteInput): FieldDiff | null {
  const gbpPhone = gbp.primaryPhone?.trim() || null;
  const sitePhone =
    (typeof site.jsonLd?.telephone === 'string' ? site.jsonLd.telephone.trim() : '') ||
    (site.textBlob ? fieldFromBlob(site.textBlob, 'Phone') : null);
  if (!gbpPhone || !sitePhone) {
    return presenceDiff('phone', gbpPhone, sitePhone);
  }
  // Seed the parser with the listing's country so a national-format site number
  // compares equal to GBP's (e.g. UK "020 …" vs "+44 …"). regionCode is a CLDR code.
  const regionCode = gbp.storefrontAddress?.regionCode;
  const country = typeof regionCode === 'string' ? regionCode : undefined;
  const normalizedGbp = normalizePhone(gbpPhone, country);
  return {
    field: 'phone',
    gbp: gbpPhone,
    site: sitePhone,
    equivalent: normalizedGbp !== '' && normalizedGbp === normalizePhone(sitePhone, country),
    strategy: 'normalized',
    presence: 'both',
  };
}

function compareWebsite(gbp: GbpInput, site: SiteInput): FieldDiff | null {
  const gbpUrl = gbp.websiteUri?.trim() || null;
  const siteUrl = (typeof site.jsonLd?.url === 'string' ? site.jsonLd.url.trim() : '') || null;
  if (!gbpUrl || !siteUrl) {
    return presenceDiff('website', gbpUrl, siteUrl);
  }
  return {
    field: 'website',
    gbp: gbpUrl,
    site: siteUrl,
    equivalent: normalizeUrl(gbpUrl) === normalizeUrl(siteUrl),
    strategy: 'normalized',
    presence: 'both',
  };
}

/** An entry in `site.domains` represents a real custom domain when it's an active, non-prefix domain. */
function isActiveCustomDomain(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const domain = entry as { domainType?: string; status?: string };
  const notPrefix = domain.domainType ? domain.domainType !== 'prefix' : true;
  const active = domain.status ? domain.status === 'active' : true;
  return notPrefix && active;
}

/**
 * The website-URL field is only compared when the site is on a real custom
 * domain — never surface a preview/prefix URL as a mismatch (it would point the
 * verified listing at a non-customer-facing URL). The `site.domains` memory key
 * holds the app's custom domains; absent/empty/lookup-failure all mean "not custom".
 */
async function resolveHasCustomDomain(appId: string | undefined): Promise<boolean> {
  if (!appId) {
    return false;
  }
  try {
    const result = await memoryRepo.get(appId, 'site.domains');
    if (!result.success || !result.exists || !Array.isArray(result.value)) {
      return false;
    }
    return result.value.some(isActiveCustomDomain);
  } catch {
    return false;
  }
}

async function compareAddress(gbp: GbpInput, site: SiteInput): Promise<FieldDiff | null> {
  const gbpAddr = formatGbpAddress(gbp.storefrontAddress) || null;

  const siteJsonLdAddr = site.jsonLd?.address;
  const structured = siteJsonLdAddr && typeof siteJsonLdAddr === 'object';
  const siteAddr =
    (structured
      ? formatSchemaAddress(siteJsonLdAddr)
      : (typeof siteJsonLdAddr === 'string' ? siteJsonLdAddr.trim() : null) ||
        (site.textBlob ? fieldFromBlob(site.textBlob, 'Address') ?? fieldFromBlob(site.textBlob, 'Location') : null)) ||
    null;

  if (!gbpAddr || !siteAddr) {
    return presenceDiff('address', gbpAddr, siteAddr);
  }

  if (structured) {
    // Fast path: canonicalized strings (abbreviations expanded) match → no LLM call.
    // Catches "123 Main St" vs "123 Main Street" deterministically.
    if (canonicalizeAddress(gbpAddr) === canonicalizeAddress(siteAddr)) {
      return { field: 'address', gbp: gbpAddr, site: siteAddr, equivalent: true, strategy: 'jsonld-structured', presence: 'both' };
    }
    // Otherwise fall through to the LLM rather than flag outright: remaining differences
    // (e.g. "AZ" vs "Arizona", reworded units) still need a judgment call.
    const structuredVerdict = await judgeEquivalence('address', gbpAddr, siteAddr);
    return {
      field: 'address',
      gbp: gbpAddr,
      site: siteAddr,
      equivalent: structuredVerdict.equivalent,
      strategy: 'llm-equivalence',
      presence: 'both',
      rationale: structuredVerdict.rationale,
    };
  }

  const verdict = await judgeEquivalence('address', gbpAddr, siteAddr);
  return { field: 'address', gbp: gbpAddr, site: siteAddr, equivalent: verdict.equivalent, strategy: 'llm-equivalence', presence: 'both', rationale: verdict.rationale };
}

async function compareHours(gbp: GbpInput, site: SiteInput): Promise<FieldDiff | null> {
  const gbpHours = formatGbpHours(gbp.regularHours) || null;

  const siteOpeningHours = site.jsonLd?.openingHours;
  const hasStructured = Array.isArray(siteOpeningHours) && canonicalizeSchemaHours(siteOpeningHours) !== '';
  const siteHoursText = !hasStructured && site.textBlob ? hoursFromBlob(site.textBlob) : null;
  const siteHoursDisplay = hasStructured ? canonicalizeSchemaHours(siteOpeningHours) : siteHoursText;

  if (!gbpHours || !siteHoursDisplay) {
    return presenceDiff('hours', gbpHours, siteHoursDisplay);
  }

  if (hasStructured) {
    return {
      field: 'hours',
      gbp: gbpHours,
      site: siteHoursDisplay,
      equivalent: canonicalizeGbpHours(gbp.regularHours) === siteHoursDisplay,
      strategy: 'jsonld-structured',
      presence: 'both',
    };
  }

  const verdict = await judgeEquivalence('hours', gbpHours, siteHoursDisplay);
  return { field: 'hours', gbp: gbpHours, site: siteHoursDisplay, equivalent: verdict.equivalent, strategy: 'llm-equivalence', presence: 'both', rationale: verdict.rationale };
}

export const diffBusinessInfoTool: SkillToolDefinition = {
  name: 'diffBusinessInfo',
  description:
    'Check whether the website and the Google Business Profile listing are in sync: ' +
    'returns per-field matches/mismatches (name, phone, address, hours, website, description). ' +
    'This is THE tool for "is my site in sync / what is different". It reads the ' +
    'site itself and uses the GBP listing already loaded by getGbpProfile, so just ' +
    'call getGbpProfile first, then call this with NO arguments.',

  // No-args: the model cannot thread the GBP/site objects (it bypassed the reliable
  // self-read and passed garbage). gbp/site are still read from `input` below as a
  // direct-call test/injection seam, but they're absent from the schema so the SDK
  // strips them from any model tool-call.
  parameters: z.object({}),

  async execute(input, context) {
    const { gbp: gbpParam, site: siteParam } = (input ?? {}) as { gbp?: GbpInput; site?: SiteInput };
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string | undefined;

    // appId is required unconditionally — it scopes every site/domain read to the
    // caller's tenant. (The gbp/site injection seam below must never let a caller
    // skip this check.)
    if (!appId) {
      return { success: false, error: 'App ID is required' };
    }

    // Resolve the GBP listing: explicit param, else the in-turn GBP_PROFILE_READY attachment.
    const gbp = gbpParam ?? readGbpFromContext(agentContext);
    if (!gbp) {
      return {
        success: false,
        error:
          'No Google Business Profile data is loaded. Call getGbpProfile first (it reads the listing), then call diffBusinessInfo.',
      };
    }

    // Resolve the site info: explicit param, else read the site now (no need for the model to thread it).
    let site: SiteInput;
    if (siteParam) {
      site = siteParam;
    } else {
      const read = await readSiteBusinessInfo(appId);
      if (!read.ok) {
        return { success: false, error: read.error };
      }
      site = { jsonLd: read.jsonLd as SiteInput['jsonLd'], textBlob: read.textBlob };
    }

    // Website URL is only compared on a real custom domain (domain-gating).
    const customDomain = await resolveHasCustomDomain(appId);

    const deterministic = [compareName(gbp, site), comparePhone(gbp, site)];
    if (customDomain) {
      deterministic.push(compareWebsite(gbp, site));
    }
    const judged = await Promise.all([compareAddress(gbp, site), compareHours(gbp, site), compareDescription(gbp, site)]);

    const fields = [...deterministic, ...judged].filter((f): f is FieldDiff => f !== null);
    const mismatches = fields.filter((f) => !f.equivalent);

    logger.info('google-business-profile-sync.diff.complete', {
      customDomain,
      comparedFields: fields.map((f) => f.field),
      mismatchFields: mismatches.map((f) => f.field),
    });

    return { success: true, fields, mismatches };
  },

  computeState(_input: unknown, output: unknown) {
    const result = output as { success?: boolean; fields?: FieldDiff[]; mismatches?: FieldDiff[] };
    if (!result?.success) {
      return null;
    }
    return {
      workflowState: 'diff-complete',
      comparedCount: result.fields?.length ?? 0,
      mismatchCount: result.mismatches?.length ?? 0,
      nextStep: result.mismatches && result.mismatches.length > 0 ? 'present-mismatches' : 'no-mismatches',
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  },
};
