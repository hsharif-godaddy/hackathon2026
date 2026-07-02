import { describe, it, expect } from 'vitest';
import { isPageFile, validateSeoSource } from '../SeoPageInjector.js';

// ─── isPageFile ───────────────────────────────────────────────────────────────

describe('isPageFile', () => {
  it('matches src/pages/*.tsx', () => {
    expect(isPageFile('src/pages/About.tsx')).toBe(true);
  });

  it('matches nested paths under src/pages/', () => {
    expect(isPageFile('src/pages/contact/index.tsx')).toBe(true);
  });

  it('matches absolute paths containing src/pages/', () => {
    expect(isPageFile('/app/src/pages/Home.tsx')).toBe(true);
  });

  it('rejects non-tsx under src/pages/', () => {
    expect(isPageFile('src/pages/Contact.ts')).toBe(false);
  });

  it('rejects tsx outside src/pages/', () => {
    expect(isPageFile('src/components/Button.tsx')).toBe(false);
  });

  it('rejects routes.tsx', () => {
    expect(isPageFile('src/routes.tsx')).toBe(false);
  });
});

// ─── validateSeoSource ────────────────────────────────────────────────────────

const FULL_SEO_PAGE = `
import { Helmet } from '@dr.pogodin/react-helmet';
export default function Contact() {
  return (
    <>
      <Helmet>
        <title>Contact — My Site</title>
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

describe('validateSeoSource', () => {
  it('returns no blocking or advisory for a fully compliant page', () => {
    const result = validateSeoSource(FULL_SEO_PAGE);
    expect(result.blocking).toHaveLength(0);
    expect(result.advisory).toHaveLength(0);
  });

  // ── blocking elements ──────────────────────────────────────────────────────

  it('reports missing title in blocking', () => {
    const src = FULL_SEO_PAGE.replace(/<title>.*<\/title>/, '');
    expect(validateSeoSource(src).blocking).toContain('title');
  });

  it('reports missing description in blocking', () => {
    const src = FULL_SEO_PAGE.replace(/name="description"[^/]*\/>/, '');
    expect(validateSeoSource(src).blocking).toContain('description');
  });

  it('reports missing canonical in blocking', () => {
    const src = FULL_SEO_PAGE.replace(/.*rel="canonical".*\n/, '');
    expect(validateSeoSource(src).blocking).toContain('canonical');
  });

  it('reports missing h1 in blocking', () => {
    const src = FULL_SEO_PAGE.replace(/<h1>.*<\/h1>/, '');
    expect(validateSeoSource(src).blocking).toContain('h1');
  });

  it('accepts motion.h1 (Framer Motion) as a valid h1 (RUBICON-545)', () => {
    const src = FULL_SEO_PAGE.replace(
      /<h1>.*<\/h1>/,
      '<motion.h1 className="text-4xl" initial={{ opacity: 0 }}>Contact Us</motion.h1>',
    );
    expect(validateSeoSource(src).blocking).not.toContain('h1');
  });

  it('accepts a member-expression heading wrapper (e.g. styled.h1) as a valid h1', () => {
    const src = FULL_SEO_PAGE.replace(/<h1>.*<\/h1>/, '<styled.h1>Contact Us</styled.h1>');
    expect(validateSeoSource(src).blocking).not.toContain('h1');
  });

  // ── advisory elements ──────────────────────────────────────────────────────

  it('reports missing og:title in advisory, not blocking', () => {
    const src = FULL_SEO_PAGE.replace(/og:title[^/]*\/>/, '');
    const result = validateSeoSource(src);
    expect(result.advisory).toContain('og:title');
    expect(result.blocking).not.toContain('og:title');
  });

  it('reports missing og:image in advisory, not blocking', () => {
    const src = FULL_SEO_PAGE.replace(/.*og:image.*\n/, '');
    const result = validateSeoSource(src);
    expect(result.advisory).toContain('og:image');
    expect(result.blocking).not.toContain('og:image');
  });

  it('reports missing twitter:card in advisory, not blocking', () => {
    const src = FULL_SEO_PAGE.replace(/twitter:card[^/]*\/>/, '');
    const result = validateSeoSource(src);
    expect(result.advisory).toContain('twitter:card');
    expect(result.blocking).not.toContain('twitter:card');
  });

  it('reports missing json-ld in advisory, not blocking', () => {
    const src = FULL_SEO_PAGE.replace(/<script type="application\/ld\+json">.*<\/script>/, '');
    const result = validateSeoSource(src);
    expect(result.advisory).toContain('json-ld');
    expect(result.blocking).not.toContain('json-ld');
  });

  it('reports all elements missing for a bare page', () => {
    const result = validateSeoSource('export default function Page() { return <></>; }');
    expect(result.blocking).toEqual(['title', 'description', 'canonical', 'h1']);
    expect(result.advisory).toEqual(['og:title', 'og:image', 'twitter:card', 'json-ld']);
  });
});
