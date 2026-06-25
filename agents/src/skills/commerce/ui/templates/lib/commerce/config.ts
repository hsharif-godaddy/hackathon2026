/**
 * Server-side Commerce config loader.
 *
 * Reads platform-managed OAuth credentials from `/local/config.json` (the Nomad
 * task-local config; `/alloc/config.json` is a compatibility symlink) and the
 * non-secret store/channel/base-url values from env.
 *
 * Every entry in `/local/config.json` is shaped `{ SYSTEM_MANAGED: boolean, VALUE: string }`.
 * Always read `.VALUE` — casting an entry to `string` produces `[object Object]`,
 * which the OAuth endpoint silently rejects with 401.
 *
 * Server-only. Do not import this file from client code; it both reads disk
 * and surfaces `clientSecret`.
 */

import { readFileSync } from 'node:fs';

const CONFIG_PATHS = ['/local/config.json', '/alloc/config.json'] as const;
const DOTENV_PATHS = ['.env', '.env.local'] as const;

interface PlatformManagedEntry {
  SYSTEM_MANAGED?: boolean;
  VALUE?: string;
}

type ConfigJson = Record<string, PlatformManagedEntry | string | undefined>;

export interface CommerceConfig {
  /** Public OAuth client id (UUID). Sent as `X-Client-ID` and as the OAuth `client_id`. */
  clientId: string;
  /** Server-only OAuth client secret. Never expose to the browser. */
  clientSecret: string;
  /** Store id from the `commerce` skill setup. */
  storeId: string;
  /** Channel id from the `commerce` skill setup. Required so admin order numbers sequence correctly. */
  channelId: string;
  /** Full origin including scheme (e.g. `https://api.godaddy.com`, `https://api.dev-godaddy.com`). */
  apiBaseUrl: string;
  /** ISO 4217 currency code used when seeding empty cart totals. */
  currencyCode: string;
}

let cachedConfigJson: ConfigJson | null = null;
let cachedDotEnv: Record<string, string> | null = null;

function readConfigJson(): ConfigJson {
  if (cachedConfigJson) return cachedConfigJson;

  for (const path of CONFIG_PATHS) {
    try {
      const raw = readFileSync(path, 'utf-8');
      cachedConfigJson = JSON.parse(raw) as ConfigJson;
      return cachedConfigJson;
    } catch {
      // Try the next path. Both missing files and parse errors fall through;
      // the final unwrap step will surface a clear error if everything is empty.
    }
  }

  cachedConfigJson = {};
  return cachedConfigJson;
}

function unwrapConfigEntry(entry: PlatformManagedEntry | string | undefined): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.VALUE === 'string') {
    return entry.VALUE;
  }
  return undefined;
}

function readConfigValue(key: string): string | undefined {
  return unwrapConfigEntry(readConfigJson()[key]);
}

function readDotEnv(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv;

  const values: Record<string, string> = {};
  for (const path of DOTENV_PATHS) {
    try {
      const raw = readFileSync(path, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        values[key] = value;
      }
    } catch {
      // Missing local env files are fine; provision writes .env when Commerce is ready.
    }
  }

  cachedDotEnv = values;
  return cachedDotEnv;
}

function readRuntimeValue(...keys: string[]): string | undefined {
  const dotEnv = readDotEnv();
  for (const key of keys) {
    const value = process.env[key] ?? dotEnv[key] ?? readConfigValue(key);
    if (value?.trim()) return value;
  }
  return undefined;
}

function requireValue(value: string | undefined, label: string, fix: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Commerce config: ${label} is missing. ${fix}`);
  }
  return trimmed;
}

/**
 * Load the full Commerce config. Throws with an actionable message if any
 * required value is missing — never prompt the user for `GODADDY_OAUTH_CLIENT_SECRET`,
 * surface the missing-config failure to the operator instead.
 */
export function readCommerceConfig(): CommerceConfig {
  const clientId = requireValue(
    readConfigValue('GODADDY_OAUTH_CLIENT_ID'),
    'GODADDY_OAUTH_CLIENT_ID',
    'The platform should mount this in /local/config.json. If it is missing, the runtime is misconfigured.'
  );

  const clientSecret = requireValue(
    readConfigValue('GODADDY_OAUTH_CLIENT_SECRET'),
    'GODADDY_OAUTH_CLIENT_SECRET',
    'This must come from /local/config.json — never from env vars or user input.'
  );

  const storeId = requireValue(
    readRuntimeValue('GODADDY_STORE_ID', 'VITE_GODADDY_STORE_ID'),
    'GODADDY_STORE_ID',
    'Run Commerce or GoDaddy Payments provisioning so the store id is written to .env. Do not hardcode store ids in source files.'
  );

  const channelId = requireValue(
    readRuntimeValue('GODADDY_CHANNEL_ID', 'VITE_GODADDY_CHANNEL_ID'),
    'GODADDY_CHANNEL_ID',
    'Run Commerce or GoDaddy Payments provisioning so the channel id is written to .env. Do not hardcode channel ids in source files.'
  );

  const apiBaseUrl = new URL(
    requireValue(
      readRuntimeValue('GODADDY_API_BASE_URL', 'VITE_GODADDY_API_BASE_URL'),
      'GODADDY_API_BASE_URL',
      'Add GODADDY_API_BASE_URL to your .env file (full URL with scheme, e.g. https://api.dev-godaddy.com).'
    )
  ).origin;

  const currencyCode =
    (readRuntimeValue('GODADDY_CURRENCY_CODE', 'VITE_GODADDY_CURRENCY_CODE') ?? 'USD').trim();

  return { clientId, clientSecret, storeId, channelId, apiBaseUrl, currencyCode };
}
