/**
 * Customer profile client.
 *
 * Fetches name/email/phone from GoDaddy's internal Profile API. Called from
 * the CRM case-creation flow to populate the case's contact fields — the
 * authenticated user's JWT only carries customerId/shopperId, not a name or
 * phone number.
 *
 * The caller must pass a cert-minted SSO JWT (see airoCertTokenService); this
 * module does not mint tokens itself.
 */

const DEFAULT_PROFILE_API_BASE = 'https://profile.api.int.test-godaddy.com';
const X_APP_KEY = 'airo-app-builder';

export interface ProfilePhone {
  code: string;
  number: string;
}

export interface CustomerProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

interface RawProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumbers?: ProfilePhone[];
}

function getProfileApiBase(): string {
  return process.env.PROFILE_API_BASE || DEFAULT_PROFILE_API_BASE;
}

function unwrapProfile(json: unknown): RawProfile {
  if (typeof json !== 'object' || json === null) return {};
  const record = json as Record<string, unknown>;
  const inner = record.data;
  if (typeof inner === 'object' && inner !== null) {
    return inner as RawProfile;
  }
  return record as RawProfile;
}

function formatPhone(phones: ProfilePhone[] | undefined): string | null {
  const first = phones?.[0];
  if (!first?.code || !first?.number) return null;
  // CRM expects digits only, no '+' or '-' separators.
  return `${first.code}${first.number}`;
}

export async function fetchCustomerProfile(
  customerId: string,
  token: string,
): Promise<CustomerProfile> {
  const url = `${getProfileApiBase()}/v1/profiles/Account/${encodeURIComponent(customerId)}`;
  // Bound the wait — a hung profile.api.int must not pin the BFF Node
  // connection until the platform's outer timeout (the SSO mint already has
  // a 10s ceiling; mirror it here and on the CRM POST).
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `sso-jwt ${token}`,
      'X-App-Key': X_APP_KEY,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Profile API request failed (${res.status}): ${snippet}`);
  }

  const raw = unwrapProfile(await res.json());

  return {
    firstName: raw.firstName ?? '',
    lastName: raw.lastName ?? '',
    email: raw.email ?? '',
    phone: formatPhone(raw.phoneNumbers),
  };
}
