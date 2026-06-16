import { describe, expect, it } from 'vitest';

import {
  flattenSchemaNodes,
  parseJsonLdBlocks,
  runAeoStructureChecks,
} from '../aeo-structure-validator.js';

const BASE_HEAD = `<!doctype html><html><head><title>Page</title></head><body>`;
const BASE_TAIL = `</body></html>`;

function html(body: string): string {
  return `${BASE_HEAD}${body}${BASE_TAIL}`;
}

describe('runAeoStructureChecks', () => {
  it('returns no issues when JSON-LD is absent', function noJsonLd() {
    expect(runAeoStructureChecks(html('<h1>Hello</h1>'), '/')).toEqual([]);
  });

  it('flags missing schema @type when JSON-LD has no @type', function missingType() {
    const page = html(
      '<script type="application/ld+json">{"@context":"https://schema.org","name":"Example"}</script>',
    );
    expect(runAeoStructureChecks(page, '/')).toContain('aeo-missing-schema-type');
  });

  it('does not flag wrong @type vs LLM recommendations', function noTypeMismatchIssue() {
    const page = html(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"About us"}</script>',
    );
    expect(runAeoStructureChecks(page, '/about')).toEqual([]);
  });

  it('passes when JSON-LD has a @type', function validType() {
    const page = html(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example","url":"https://example.com/"}</script>',
    );
    expect(runAeoStructureChecks(page, '/')).toEqual([]);
  });

  it('flags canonical and og:url mismatch', function headUrlMismatch() {
    const page = html(`
      <head>
        <link rel="canonical" href="https://example.com/about" />
        <meta property="og:url" content="https://example.com/wrong" />
      </head>
    `);
    expect(runAeoStructureChecks(page, '/about', { pageUrl: 'https://example.com/about' })).toContain(
      'aeo-url-mismatch:head',
    );
  });

  it('flags JSON-LD url that does not match canonical', function jsonLdUrlMismatch() {
    const page = html(`
      <head><link rel="canonical" href="https://example.com/about" /></head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"About","url":"https://example.com/other"}</script>
    `);
    expect(runAeoStructureChecks(page, '/about', { pageUrl: 'https://example.com/about' })).toContain(
      'aeo-url-mismatch:jsonld',
    );
  });

  it('flags canonical that does not match scanned published page URL', function canonicalScannedMismatch() {
    const page = html(`
      <head>
        <link rel="canonical" href="https://example.com/wrong" />
        <meta property="og:url" content="https://example.com/wrong" />
      </head>
    `);
    expect(
      runAeoStructureChecks(page, '/about', {
        pageUrl: 'https://example.com/about',
        validateAgainstScannedUrl: true,
      }),
    ).toEqual(
      expect.arrayContaining(['aeo-url-mismatch:canonical-page', 'aeo-url-mismatch:og-page']),
    );
  });

  it('flags JSON-LD url that does not match scanned published page URL', function jsonLdScannedMismatch() {
    const page = html(`
      <head><link rel="canonical" href="https://example.com/about" /></head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"About","url":"https://example.com/wrong"}</script>
    `);
    expect(
      runAeoStructureChecks(page, '/about', {
        pageUrl: 'https://example.com/about',
        validateAgainstScannedUrl: true,
      }),
    ).toContain('aeo-url-mismatch:jsonld-page');
  });

  it('does not flag scanned URL mismatch on preview audits', function previewSkipsScannedMismatch() {
    const page = html(`
      <head>
        <link rel="canonical" href="https://example.com/about" />
        <meta property="og:url" content="https://example.com/about" />
      </head>
    `);
    expect(
      runAeoStructureChecks(page, '/about', {
        pageUrl: 'https://preview.example.com/about',
        validateAgainstScannedUrl: false,
      }),
    ).toEqual([]);
  });
});

describe('parseJsonLdBlocks', () => {
  it('parses valid JSON-LD blocks and skips invalid ones', function parseBlocks() {
    const page = html(
      '<script type="application/ld+json">{"@type":"WebSite"}</script>' +
        '<script type="application/ld+json">{ bad json }</script>',
    );
    expect(parseJsonLdBlocks(page)).toEqual([{ '@type': 'WebSite' }]);
  });
});

describe('flattenSchemaNodes', () => {
  it('collects nodes from @graph arrays', function graphNodes() {
    const nodes = flattenSchemaNodes({
      '@graph': [
        { '@type': 'WebSite', name: 'Example', url: 'https://example.com/' },
        { '@type': 'Organization', name: 'Example Co' },
      ],
    });
    expect(nodes).toHaveLength(2);
  });
});
