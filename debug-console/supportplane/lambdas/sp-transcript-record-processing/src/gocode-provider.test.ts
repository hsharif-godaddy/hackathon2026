import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sso-jwt pulls gd-auth-client + aws-sdk (unresolvable in the cdk workspace) and
// hits STS/SSO — mock it. fetch is stubbed per-test.
vi.mock('./sso-jwt.js', () => ({ mintSsoJwt: vi.fn().mockResolvedValue('fake-jwt') }));

// Mock vocabularies — return empty vocab by default (first-ever extraction scenario).
vi.mock('./vocabularies.js', () => ({
  getVocabulary: vi.fn().mockResolvedValue({
    goal: [],
    intent: ['publish_failure', 'domain_setup'],
    sub_intent: [],
    platform_area: ['publisher', 'domains'],
    error_type: [],
    issue_resolution: [],
    friction_point: [],
    fix_category: [],
  }),
  formatVocabularyForPrompt: vi.fn().mockReturnValue('intent: ["publish_failure", "domain_setup"]\nplatform_area: ["publisher", "domains"]'),
  VOCABULARY_PROMPT_RULES: '## VOCABULARY CONTEXT\nRULES:\n- You MUST pick from the existing list',
}));

import { GoCodeProvider } from './gocode-provider.js';

const provider = new GoCodeProvider();

function mockFetchJson(content: string, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    })
  );
}

beforeEach(() => {
  vi.stubEnv('ENV_NAME', 'dev');
  vi.stubEnv('S2S_IAM_JWT_ROLE_ARN', 'arn:aws:iam::123:role/s2s');
  vi.stubEnv('SSO_HOST', 'sso.test-godaddy.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GoCodeProvider', () => {
  it('is unconfigured without the S2S role / SSO host', () => {
    vi.stubEnv('S2S_IAM_JWT_ROLE_ARN', '');
    expect(provider.isConfigured()).toBe(false);
  });

  it('is configured with the S2S role + SSO host', () => {
    expect(provider.isConfigured()).toBe(true);
  });

  it('returns null for an empty transcript (no LLM call)', async () => {
    mockFetchJson('{}');
    const result = await provider.enrich({ interaction_id: 'x', full_transcript: '   ' });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses v2 resolution-ready fields into an EnrichmentResult', async () => {
    mockFetchJson(
      JSON.stringify({
        goal: 'publish_site',
        intent: 'publish_failure',
        sub_intent: 'silent_publish_failure',
        platform_area: 'publisher',
        error_type: 'deploy_timeout',
        customer_sentiment: 'Negative',
        issue_resolution: 'escalated',
        friction_point: 'no_error_message',
        preventable_contact: true,
        fix_category: 'bug_fix',
        where_airo_went_wrong: 'publish reported success but site never went live',
        symptoms: ['site not loading', 'publish button said success', 'old content still showing'],
        search_keywords: ['publish', 'deploy', 'timeout', 'site down', 'silent failure'],
        root_cause: 'DNS not propagated',
        recommended_fix: 'Wait for propagation / re-point A record',
        airo_failure: 'publish reported success but site never went live',
        conversation_summary: 'User could not publish their site.',
        tags: ['Publish_Failure', 'domain_connection_failed'],
      })
    );

    const result = await provider.enrich({
      interaction_id: 'x',
      full_transcript: 'customer could not publish',
    });

    expect(result).toEqual({
      provider: 'gocode',
      goal: 'publish_site',
      intent: 'publish_failure',
      sub_intent: 'silent_publish_failure',
      platform_area: 'publisher',
      error_type: 'deploy_timeout',
      customer_sentiment: 'negative',
      issue_resolution: 'escalated',
      friction_point: 'no_error_message',
      preventable_contact: true,
      fix_category: 'bug_fix',
      where_airo_went_wrong: 'publish reported success but site never went live',
      symptoms: ['site not loading', 'publish button said success', 'old content still showing'],
      search_keywords: ['publish', 'deploy', 'timeout', 'site down', 'silent failure'],
      root_cause: 'DNS not propagated',
      recommended_fix: 'Wait for propagation / re-point A record',
      airo_failure: 'publish reported success but site never went live',
      conversation_summary: 'User could not publish their site.',
      tags: ['publish_failure', 'domain_connection_failed'],
    });
  });

  it('injects vocabulary context and dedup rules into the prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await provider.enrich({ interaction_id: 'x', full_transcript: 'could not publish' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      messages: Array<{ content: string }>;
    };
    const prompt: string = body.messages[0].content;
    expect(prompt).toContain('Airo App Builder');
    expect(prompt).toContain('VOCABULARY CONTEXT');
    expect(prompt).toContain('MUST pick from the existing list');
    expect(prompt).toContain('airo_failure');
    expect(prompt).toContain('symptoms');
    expect(prompt).toContain('search_keywords');
  });

  it('authenticates with sso-jwt scheme against GoCode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await provider.enrich({ interaction_id: 'x', full_transcript: 'could not publish' });

    const url: string = fetchMock.mock.calls[0][0] as string;
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(url).toBe('https://api.gocode.caas.dev-gdcorp.tools/v1/chat/completions');
    expect(headers.Authorization).toBe('sso-jwt fake-jwt');
  });

  it('tolerates prose around the JSON object', async () => {
    mockFetchJson('Here you go:\n{"tags":["preview_mismatch"],"intent":"preview"}\nThanks!');
    const result = await provider.enrich({ interaction_id: 'x', full_transcript: 't' });
    expect(result).toMatchObject({ provider: 'gocode', tags: ['preview_mismatch'], intent: 'preview' });
  });

  it('throws when the response has no parseable JSON (redrivable)', async () => {
    mockFetchJson('Sorry, I cannot help with that.');
    await expect(
      provider.enrich({ interaction_id: 'x', full_transcript: 't' })
    ).rejects.toThrow(/GoCode returned unparseable response/);
  });

  it('throws when the JSON body is malformed (redrivable)', async () => {
    mockFetchJson('{"tags": [invalid}');
    await expect(
      provider.enrich({ interaction_id: 'x', full_transcript: 't' })
    ).rejects.toThrow(/GoCode returned unparseable response/);
  });

  it('throws on a non-OK response (so the worker can redrive)', async () => {
    mockFetchJson('rate limited', false, 429);
    await expect(
      provider.enrich({ interaction_id: 'x', full_transcript: 't' })
    ).rejects.toThrow(/GoCode API error 429/);
  });

  it('handles missing optional fields gracefully (returns undefined for absent fields)', async () => {
    mockFetchJson(JSON.stringify({
      intent: 'billing_question',
      customer_sentiment: 'neutral',
      conversation_summary: 'Customer asked about billing.',
    }));
    const result = await provider.enrich({ interaction_id: 'x', full_transcript: 'billing question' });
    expect(result).toMatchObject({
      provider: 'gocode',
      intent: 'billing_question',
      customer_sentiment: 'neutral',
      conversation_summary: 'Customer asked about billing.',
    });
    expect(result?.symptoms).toBeUndefined();
    expect(result?.search_keywords).toBeUndefined();
    expect(result?.preventable_contact).toBeUndefined();
  });
});
