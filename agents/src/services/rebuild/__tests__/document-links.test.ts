import { describe, expect, it } from 'vitest';

import type { AtlasLink } from '../../../types/atlas-api.js';
import { isDocumentLinkUrl, mapAtlasDocumentLinks } from '../document-links.js';

describe('document-links', function documentLinksTests() {
  describe('#isDocumentLinkUrl', function isDocumentLinkUrlTests() {
    it('matches common document extensions', function extensions() {
      expect(isDocumentLinkUrl('/files/menu.pdf')).toBe(true);
      expect(isDocumentLinkUrl('https://example.com/guide.PDF?download=1')).toBe(true);
      expect(isDocumentLinkUrl('/assets/report.docx')).toBe(true);
      expect(isDocumentLinkUrl('/sheet.xlsx')).toBe(true);
    });

    it('rejects non-document paths', function rejectNonDocuments() {
      expect(isDocumentLinkUrl('/cakes')).toBe(false);
      expect(isDocumentLinkUrl('/order')).toBe(false);
      expect(isDocumentLinkUrl('https://example.com/about')).toBe(false);
    });
  });

  describe('#mapAtlasDocumentLinks', function mapAtlasDocumentLinksTests() {
    it('resolves same-origin PDFs to absolute URLs', function sameOriginPdf() {
      const links: AtlasLink[] = [
        { url: '/files/cake-cutting-guide.pdf', text: 'printer-friendly cake cutting guide', isInternal: true },
        { url: 'https://urbancookies.com/files/menu.pdf', text: 'printer-friendly menu', isInternal: true },
      ];

      expect(mapAtlasDocumentLinks(links, 'https://urbancookies.com/cakes')).toEqual([
        {
          label: 'printer-friendly cake cutting guide',
          url: 'https://urbancookies.com/files/cake-cutting-guide.pdf',
          isExternal: false,
        },
        {
          label: 'printer-friendly menu',
          url: 'https://urbancookies.com/files/menu.pdf',
          isExternal: false,
        },
      ]);
    });

    it('keeps external document links absolute', function externalPdf() {
      const links: AtlasLink[] = [
        { url: 'https://cdn.partner.com/brochure.pdf', text: 'Download brochure', isInternal: false },
      ];

      expect(mapAtlasDocumentLinks(links, 'https://example.com/cakes')).toEqual([
        {
          label: 'Download brochure',
          url: 'https://cdn.partner.com/brochure.pdf',
          isExternal: true,
        },
      ]);
    });

    it('ignores nav-style internal page links and non-document URLs', function filterNavLinks() {
      const links: AtlasLink[] = [
        { url: '/order', text: 'Order online', isInternal: true },
        { url: '#cake-cutting-guide', text: 'Jump to guide', isInternal: true },
        { url: 'mailto:hi@example.com', text: 'Email us', isInternal: true },
        { url: '/files/menu.pdf', text: 'Menu PDF', isInternal: true },
      ];

      expect(mapAtlasDocumentLinks(links, 'https://example.com/cakes')).toEqual([
        {
          label: 'Menu PDF',
          url: 'https://example.com/files/menu.pdf',
          isExternal: false,
        },
      ]);
    });

    it('dedupes repeated document URLs', function dedupe() {
      const links: AtlasLink[] = [
        { url: '/menu.pdf', text: 'Menu', isInternal: true },
        { url: 'https://example.com/menu.pdf', text: 'Menu again', isInternal: true },
      ];

      expect(mapAtlasDocumentLinks(links, 'https://example.com/cakes')).toHaveLength(1);
    });
  });
});
