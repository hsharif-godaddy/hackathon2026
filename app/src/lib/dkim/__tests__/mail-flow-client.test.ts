import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailFlowClient } from '../mail-flow-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const validResponse = {
  dkimValid: true,
  dkimResult: 'DKIM_VALID',
  dkimRecordDetected: { cnames: ['s1.dkim.example_com.f86.onsecureserver.net.'] },
  dkimRecordExpected: { cnames: ['s1.dkim.example_com.f86.onsecureserver.net.'] },
  dmarcValid: true,
  dmarcResult: 'DMARC_VALID',
};

describe('MailFlowClient', () => {
  const baseUrl = 'https://dev.email-record.myprofessionalmail.com/v1';

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.VOX_MAIL_FLOW_API_URL = baseUrl;
  });

  afterEach(() => {
    delete process.env.VOX_MAIL_FLOW_API_URL;
  });

  it('calls GET /domains/:domain/dkim with User-Agent but no auth header', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(validResponse), { status: 200 })
    );
    const client = new MailFlowClient();
    await client.getDkimStatus('example.com');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/domains/example.com/dkim`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('airo-builder-bff');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns parsed DkimStatusResponse', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(validResponse), { status: 200 })
    );
    const client = new MailFlowClient();
    const result = await client.getDkimStatus('example.com');
    expect(result.dkimValid).toBe(true);
    expect(result.dkimResult).toBe('DKIM_VALID');
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    const client = new MailFlowClient();
    await expect(client.getDkimStatus('unknown.com')).rejects.toThrow('404');
  });

  it('throws when response body fails Zod validation', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 })
    );
    const client = new MailFlowClient();
    await expect(client.getDkimStatus('example.com')).rejects.toThrow();
  });

  it('URL-encodes the domain segment to defend against injection via ?domain=', async () => {
    // The status route only validates `if (!domain)`, so values containing
    // path separators or query characters reach this client unchanged.
    // Without encodeURIComponent, `foo/../admin` would mutate the upstream
    // URL shape; with encoding, it lands as a single path segment.
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(validResponse), { status: 200 }),
    );
    const client = new MailFlowClient();
    await client.getDkimStatus('foo/../admin');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/domains/foo%2F..%2Fadmin/dkim`);
    // Critical: NO unescaped `..` segment in the final URL.
    expect(url).not.toContain('/admin');
    expect(url).not.toContain('/..');
  });
});
