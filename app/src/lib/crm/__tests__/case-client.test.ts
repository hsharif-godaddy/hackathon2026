import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../airo-cert-token', () => ({
  airoCertTokenService: {
    getToken: vi.fn(),
  },
}));

import { airoCertTokenService } from '../airo-cert-token';
import { buildCaseBody, type OpenCaseInput, openCrmCase } from '../case-client';
import type { CustomerProfile } from '../profile-client';

const FAKE_TOKEN = 'fake-sso-jwt';

const INPUT: OpenCaseInput = {
  customerId: 'cust-1',
  shopperId: 'shop-1',
  category: 'issue',
  description: 'my site is not working',
  appId: 'app-123',
};

const PROFILE: CustomerProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '15551234',
};

describe('buildCaseBody', () => {
  it('populates contact, category, severity S2, and additionalData per CRM spec', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    expect(body.contactName).toBe('Jane Doe');
    expect(body.contactFirstName).toBe('Jane');
    expect(body.contactLastName).toBe('Doe');
    expect(body.contactEmail).toBe('jane@example.com');
    // PROFILE.phone is already digits-only (formatted by profile-client).
    expect(body.contactPhone).toBe('15551234');
    expect(body.shopperId).toBe('shop-1');
    expect(body.primaryCategory).toBe('Websites');
    expect(body.secondaryCategory).toBe('Airo AI Builder');
    expect(body.issue).toBe('General Support');
    expect(body.recordType).toBe('standard');
    expect(body.additionalData.severity).toBe('S2');
    expect(body.additionalData.permissionToMakeChanges).toBe('true');
    expect(body.additionalData.escalated).toBe('true');
    expect(body.additionalData.type).toBe('Complete');
    // Category routing prefix is embedded in escalationDetails because CRM
    // silently drops unsupported additionalData keys (e.g. `flow`).
    expect(body.additionalData.escalationDetails).toBe('[ISSUE] my site is not working');
    expect(body.caseNotes[0]?.note).toBe('Comment : (appid - app-123) [ISSUE] my site is not working');
  });

  it('opts into CMAPI async creation by sending externalSystemId', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    // externalSystemId triggers CMAPI's async path so we don't block on
    // Salesforce. Shape: airo-{customerId}-{appId|na}-{epochMs}-{uuid8}.
    // The customerId + uuid suffix together prevent collisions on rapid
    // double-submit (same shopper, same ms) and on cross-customer 'na'
    // appId submissions (onboarding flow).
    expect(body.externalSystemId).toMatch(
      /^airo-cust-1-app-123-\d+-[a-f0-9]{8}$/,
    );
  });

  it('externalSystemId is unique across rapid back-to-back calls (same input)', () => {
    // Defense-in-depth: even if Date.now() collides (sub-ms double-click),
    // the random suffix makes the ID unique. Without this guarantee, CMAPI's
    // idempotency layer can either silently merge the second case into the
    // first or attach the second's note to the wrong case.
    const a = buildCaseBody(INPUT, PROFILE).externalSystemId;
    const b = buildCaseBody(INPUT, PROFILE).externalSystemId;
    expect(a).not.toBe(b);
  });

  // Regression-lock: legacy keys / unsupported keys must not appear — CRM
  // silently drops them, so their presence would mask a contract drift.
  it('omits all legacy and unsupported additionalData keys', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    expect(body.additionalData).not.toHaveProperty('Type');
    expect(body.additionalData).not.toHaveProperty('Permission to Make Changes');
    expect(body.additionalData).not.toHaveProperty('Escalation Details');
    expect(body.additionalData).not.toHaveProperty('followUpConsent');
    expect(body.additionalData).not.toHaveProperty('flow');
    expect(body.additionalData).not.toHaveProperty('appId');
  });

  it('omits contactPhone when profile phone is null', () => {
    const body = buildCaseBody(INPUT, { ...PROFILE, phone: null });
    expect(body.contactPhone).toBeUndefined();
  });

  it('uses Comment-only note format when appId is null', () => {
    const body = buildCaseBody({ ...INPUT, appId: null }, PROFILE);
    expect(body.caseNotes[0]?.note).toBe('Comment : [ISSUE] my site is not working');
    expect(body.caseNotes[0]?.note).not.toContain('appid');
  });

  it('truncates very long descriptions in caseNotes and escalationDetails', () => {
    const longDesc = 'x'.repeat(5000);
    const body = buildCaseBody({ ...INPUT, description: longDesc }, PROFILE);
    const prefix = 'Comment : (appid - app-123) [ISSUE] ';
    expect(body.caseNotes[0]?.note.length).toBeLessThanOrEqual(4000 + prefix.length);
    // Lock that truncation runs on the description before composition, so
    // the prefix stays intact at the front of the note.
    expect(body.caseNotes[0]?.note.startsWith(prefix)).toBe(true);
    expect(body.additionalData.escalationDetails.length).toBeLessThanOrEqual(4000 + '[ISSUE] '.length);
  });
});

describe('openCrmCase', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.mocked(airoCertTokenService.getToken).mockResolvedValue(FAKE_TOKEN);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function mockFetchSequence(profileResponse: Partial<Response>, caseResponse: Partial<Response>) {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(profileResponse as Response)
      .mockResolvedValueOnce(caseResponse as Response);
  }

  it('fetches profile with sso-jwt auth + X-App-Key, then POSTs CRM case and returns caseId', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          data: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            phoneNumbers: [{ code: '1', number: '5551234' }],
          },
        }),
      },
      {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: 'case-xyz', caseNumber: '000123' } }),
      },
    );

    const result = await openCrmCase(INPUT);

    const calls = vi.mocked(global.fetch).mock.calls;
    const [profileUrl, profileInit] = calls[0] as [string, RequestInit];
    expect(profileUrl).toMatch(/\/v1\/profiles\/Account\/cust-1$/);
    expect((profileInit.headers as Record<string, string>).authorization).toBe(`sso-jwt ${FAKE_TOKEN}`);
    expect((profileInit.headers as Record<string, string>)['X-App-Key']).toBe('airo-app-builder');

    const [caseUrl, caseInit] = calls[1] as [string, RequestInit];
    expect(caseUrl).toMatch(/\/api\/case-management\/v1\/case$/);
    expect((caseInit.headers as Record<string, string>).authorization).toBe(`sso-jwt ${FAKE_TOKEN}`);
    const sentBody = JSON.parse(caseInit.body as string);
    expect(sentBody.shopperId).toBe('shop-1');
    expect(sentBody.primaryCategory).toBe('Websites');
    expect(sentBody.additionalData.severity).toBe('S2');
    // Locks formatPhone end-to-end: profile { code: '1', number: '5551234' }
    // must serialize to digits-only '15551234' on the CRM body. Reverting to
    // '+1-5551234' would now fail this assertion.
    expect(sentBody.contactPhone).toBe('15551234');

    expect(result).toEqual({ caseId: 'case-xyz', caseNumber: '000123' });
  });

  it('returns referenceId as caseId for the async CMAPI ACCEPTED shape', async () => {
    // CMAPI's primary shape after Feb 2026:
    //   { status: "ACCEPTED", referenceId: "EXT-...", message, timestamp }
    // The legacy `id` field is absent. Without explicit coverage a
    // regression that ignored `referenceId` would silently `incomplete`
    // every async submission (review S-5).
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [],
        }),
      },
      {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({
          status: 'ACCEPTED',
          referenceId: 'EXT-airo-cust-1-app-123-1700000000000-deadbeef',
          message: 'queued',
        }),
      },
    );
    const result = await openCrmCase(INPUT);
    expect(result.caseId).toBe('EXT-airo-cust-1-app-123-1700000000000-deadbeef');
    // Async mode does not return a Salesforce caseNumber; that's fetched
    // later via GET ?externalId=<referenceId>.
    expect(result.caseNumber).toBeUndefined();
  });

  it('throws with status in message when CRM returns non-2xx', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: false, status: 500, text: async () => 'CRM down' },
    );
    await expect(openCrmCase(INPUT)).rejects.toThrow(/CRM case request failed \(500\)/);
  });

  it('omits contactPhone when profile has empty phoneNumbers', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: true, status: 200, text: async () => '{}' },
    );
    await openCrmCase(INPUT);
    const [, caseInit] = vi.mocked(global.fetch).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(caseInit.body as string);
    expect(body.contactPhone).toBeUndefined();
  });

  it('throws when profile fetch fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response);
    await expect(openCrmCase(INPUT)).rejects.toThrow(/Profile API request failed \(404\)/);
  });

  // 2xx with malformed/empty body — do not throw (the case may have been
  // filed), but emit a distinct warn so the lack of caseId is auditable.
  it('returns empty result and logs parse_failed when CRM returns 2xx with non-JSON body', async () => {
    const { logger } = await import('@/lib/request-context');
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: true, status: 200, text: async () => '<html>broken proxy</html>' },
    );
    const result = await openCrmCase(INPUT);
    // 2xx with non-JSON body → return `incomplete: true` so the route can
    // surface a `crmIncomplete` warning. Distinct from the throw on 5xx
    // (which sets `crmFailed: true`) and from a 2xx-with-id success.
    expect(result).toEqual({ incomplete: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'feedback.crm.case-client.post.parse_failed',
      expect.objectContaining({ status: 200 }),
    );
  });

  it('returns incomplete and logs no_case_id when CRM returns 2xx JSON with no recognized id', async () => {
    const { logger } = await import('@/lib/request-context');
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      // Parseable JSON but no `id` / `caseId` / `referenceId` /
      // `externalSystemId` field — case may have been filed but we have
      // no audit-trail link. Distinct from parse_failed so dashboards
      // can disambiguate.
      { ok: true, status: 200, text: async () => JSON.stringify({ status: 'ACCEPTED', message: 'queued' }) },
    );
    const result = await openCrmCase(INPUT);
    expect(result).toEqual({ incomplete: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'feedback.crm.case-client.post.no_case_id',
      expect.objectContaining({ status: 200 }),
    );
  });
});

const PROFILE_ADA: CustomerProfile = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '555-0100',
};

// Category routing is encoded in escalationDetails text (CRM strips
// unsupported additionalData keys like `flow`). The literal `[ISSUE]` /
// `[SUPPORT]` / `[FEEDBACK NPS X]` marker is the routing contract.
describe('buildCaseBody — category variants', () => {
  it('issue: escalationDetails prefixed [ISSUE]', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'issue',
      description: 'It broke',
      appId: 'app-1',
      topics: [],
    };
    const body = buildCaseBody(input, PROFILE_ADA);
    expect(body.additionalData.severity).toBe('S2');
    expect(body.additionalData.escalationDetails).toBe('[ISSUE] It broke');
    expect(body.caseNotes[0].note).toBe('Comment : (appid - app-1) [ISSUE] It broke');
  });

  it('support: escalationDetails prefixed [SUPPORT] with topics inline', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'support',
      description: 'Cannot publish',
      appId: 'app-2',
      topics: ['publish', 'errors'],
    };
    const body = buildCaseBody(input, PROFILE_ADA);
    expect(body.additionalData.severity).toBe('S2');
    expect(body.additionalData.escalationDetails).toBe(
      '[SUPPORT] Cannot publish | Topics: publish, errors',
    );
    expect(body.caseNotes[0].note).toBe(
      'Comment : (appid - app-2) [SUPPORT] Cannot publish | Topics: publish, errors',
    );
  });

  it('feedback: escalationDetails prefixed [FEEDBACK NPS X | consent=yes] with rating + consent + topics', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'feedback',
      description: 'Slow generation',
      appId: 'app-3',
      topics: ['speed'],
      rating: 2,
      customerConsent: true,
    };
    const body = buildCaseBody(input, PROFILE_ADA);
    expect(body.additionalData.severity).toBe('S2');
    // Consent marker (`consent=yes` / `consent=no`) is part of the
    // routing prefix so support agents see at a glance whether the
    // customer opted in for follow-up.
    expect(body.additionalData.escalationDetails).toBe(
      '[FEEDBACK NPS 2 | consent=yes] Slow generation | Topics: speed',
    );
    expect(body.caseNotes[0].note).toBe(
      'Comment : (appid - app-3) [FEEDBACK NPS 2 | consent=yes] Slow generation | Topics: speed',
    );
  });

  it('feedback: declined consent renders [FEEDBACK NPS X | consent=no]', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'feedback',
      description: 'meh',
      appId: 'app-3',
      topics: [],
      rating: 3,
      customerConsent: false,
    };
    const body = buildCaseBody(input, PROFILE_ADA);
    expect(body.additionalData.escalationDetails).toBe(
      '[FEEDBACK NPS 3 | consent=no] meh',
    );
  });

  // Discriminated union now forbids `feedback` without `rating` +
  // `customerConsent` at compile time — the previous `[FEEDBACK NPS ?]`
  // fallback branch is gone (review F-6). A test for it would need an
  // `as unknown as` cast that defeats the type check the union exists
  // to enforce, so this scenario is covered by the typecheck instead.
});
