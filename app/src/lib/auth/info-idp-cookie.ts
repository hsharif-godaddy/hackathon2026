import { logger } from '@/lib/request-context';

type InfoIdpRecord = Record<string, unknown>;

const INFO_IDP_COOKIE_NAMES = ['login_info_idp', 'info_idp'] as const;
const AUTH_BLOCKS = ['basic', 's2s', 'e2s', 'cert2s', 'e2s2s'] as const;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseInfoIdp(raw: string | undefined, cookieName?: string): InfoIdpRecord | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as InfoIdpRecord;
    }
  } catch {
    logger.warn('auth.infoIdp.parse.failed', { cookieName });
    return null;
  }

  return null;
}

function emailFromBlock(block: unknown): string | undefined {
  if (!block || typeof block !== 'object') return undefined;

  const record = block as InfoIdpRecord;
  const email = readString(record.email);
  if (email?.includes('@')) return email;

  const username = readString(record.username);
  if (username?.includes('@')) return username;

  return undefined;
}

export function getEmailFromInfoIdp(raw: string | undefined, cookieName?: string): string | undefined {
  const info = parseInfoIdp(raw, cookieName);
  if (!info) return undefined;

  const authType = readString(info.auth);
  if (authType) {
    const fromAuthBlock = emailFromBlock(info[authType]);
    if (fromAuthBlock) return fromAuthBlock;
  }

  for (const key of AUTH_BLOCKS) {
    const fromBlock = emailFromBlock(info[key]);
    if (fromBlock) return fromBlock;
  }

  return emailFromBlock(info);
}

export function getAccountNameFromInfoIdp(raw: string | undefined, cookieName?: string): string | undefined {
  const info = parseInfoIdp(raw, cookieName);
  if (!info) return undefined;

  const authType = readString(info.auth);
  const block = authType && info[authType] && typeof info[authType] === 'object'
    ? info[authType]
    : info.basic;

  if (!block || typeof block !== 'object') return undefined;

  const record = block as InfoIdpRecord;
  const fullName = [readString(record.firstname), readString(record.lastname)]
    .filter(Boolean)
    .join(' ');

  return fullName || readString(record.info_accountName);
}

function readCookieValue(cookieHeader: string, cookieName: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

// info_idp / login_info_idp are not HttpOnly — values are attacker-controllable for
// the attacker's own session. Display / CDS seeding only; never use for authz.
export function getEmailFromDocumentInfoIdpCookies(): string | undefined {
  if (typeof document === 'undefined') return undefined;

  for (const cookieName of INFO_IDP_COOKIE_NAMES) {
    const raw = readCookieValue(document.cookie, cookieName);
    const email = getEmailFromInfoIdp(raw, cookieName);
    if (email) return email;
  }

  return undefined;
}

export function getEmailFromRequestInfoIdpCookies(
  cookies: { get: (name: string) => { value: string } | undefined },
): string | undefined {
  for (const cookieName of INFO_IDP_COOKIE_NAMES) {
    const email = getEmailFromInfoIdp(cookies.get(cookieName)?.value, cookieName);
    if (email) return email;
  }

  return undefined;
}

export function getAccountNameFromRequestInfoIdpCookies(
  cookies: { get: (name: string) => { value: string } | undefined },
): string | undefined {
  for (const cookieName of INFO_IDP_COOKIE_NAMES) {
    const accountName = getAccountNameFromInfoIdp(cookies.get(cookieName)?.value, cookieName);
    if (accountName) return accountName;
  }

  return undefined;
}
