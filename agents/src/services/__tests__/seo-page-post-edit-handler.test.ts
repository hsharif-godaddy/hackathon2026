import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecordPageSeoStateFn, mockReadFileFn } = vi.hoisted(() => ({
  mockRecordPageSeoStateFn: vi.fn(),
  mockReadFileFn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFileFn,
}));

vi.mock('../SeoPageRegistry.js', () => ({
  recordPageSeoState: mockRecordPageSeoStateFn,
}));

import { seoPagePostEditHandler } from '../seo-page-post-edit-handler.js';

const mockReadFile = mockReadFileFn;
const mockRecordPageSeoState = mockRecordPageSeoStateFn;

const BASE_CONTEXT = {
  appId: 'app123',
  appPath: '/app',
  fullPath: '/app/src/pages/contact.tsx',
  filePath: 'src/pages/contact.tsx',
  command: 'create' as const,
};

const PAGE_WITHOUT_SEO = `
import React from 'react';
export default function Contact() {
  return <main><h1>Contact Us</h1></main>;
}
`.trimStart();

const PAGE_WITH_FULL_SEO = `
import { Helmet } from '@dr.pogodin/react-helmet';
export default function Contact() {
  return (
    <>
      <Helmet>
        <title>Contact — Test Site</title>
        <meta name="description" content="Real description" />
        <link rel="canonical" href="/contact" />
        <meta property="og:title" content="Contact" />
        <meta property="og:image" content="https://example.com/img.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json">{"@context":"https://schema.org"}</script>
      </Helmet>
      <main><h1>Contact Us</h1></main>
    </>
  );
}
`.trimStart();

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── matches ──────────────────────────────────────────────────────────────────

describe('seoPagePostEditHandler.matches', () => {
  it('matches src/pages/*.tsx', () => {
    expect(seoPagePostEditHandler.matches('src/pages/About.tsx', BASE_CONTEXT)).toBe(true);
  });

  it('matches nested under src/pages/', () => {
    expect(seoPagePostEditHandler.matches('src/pages/contact/index.tsx', BASE_CONTEXT)).toBe(true);
  });

  it('does not match routes.tsx', () => {
    expect(seoPagePostEditHandler.matches('src/routes.tsx', BASE_CONTEXT)).toBe(false);
  });

  it('does not match non-tsx under src/pages/', () => {
    expect(seoPagePostEditHandler.matches('src/pages/Contact.ts', BASE_CONTEXT)).toBe(false);
  });

  it('does not match component outside src/pages/', () => {
    expect(seoPagePostEditHandler.matches('src/components/Button.tsx', BASE_CONTEXT)).toBe(false);
  });
});

// ─── run ──────────────────────────────────────────────────────────────────────

describe('seoPagePostEditHandler.run', () => {
  it('records missing elements for a page without SEO', async () => {
    mockReadFile.mockResolvedValue(PAGE_WITHOUT_SEO as unknown as Buffer);

    await seoPagePostEditHandler.run(BASE_CONTEXT, 'ok');

    expect(mockRecordPageSeoState).toHaveBeenCalledOnce();
    const [appId, filePath, missing] = mockRecordPageSeoState.mock.calls[0] as [string, string, string[]];
    expect(appId).toBe('app123');
    expect(filePath).toBe('src/pages/contact.tsx');
    expect(missing.length).toBeGreaterThan(0);
  });

  it('records empty missing array for a fully compliant page', async () => {
    mockReadFile.mockResolvedValue(PAGE_WITH_FULL_SEO as unknown as Buffer);

    await seoPagePostEditHandler.run(BASE_CONTEXT, 'ok');

    expect(mockRecordPageSeoState).toHaveBeenCalledOnce();
    const [, , missing] = mockRecordPageSeoState.mock.calls[0] as [string, string, string[]];
    expect(missing).toHaveLength(0);
  });

  it('does not record state when readFile fails', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await seoPagePostEditHandler.run(BASE_CONTEXT, 'ok');

    expect(mockRecordPageSeoState).not.toHaveBeenCalled();
  });

  it('returns base result unchanged', async () => {
    mockReadFile.mockResolvedValue(PAGE_WITH_FULL_SEO as unknown as Buffer);

    const result = await seoPagePostEditHandler.run(BASE_CONTEXT, 'base result');

    expect(result).toBe('base result');
  });
});
