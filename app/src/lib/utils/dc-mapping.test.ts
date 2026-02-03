import { describe, expect, it, vi, beforeEach } from 'vitest';

import { getDatacenterFromMarketId } from './dc-mapping';

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('dc-mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('#getDatacenterFromMarketId', () => {
    describe('North America (p3)', () => {
      it('should return p3 for en-US', () => {
        expect(getDatacenterFromMarketId('en-US')).toBe('p3');
      });

      it('should return p3 for en-CA', () => {
        expect(getDatacenterFromMarketId('en-CA')).toBe('p3');
      });

      it('should return p3 for es-MX', () => {
        expect(getDatacenterFromMarketId('es-MX')).toBe('p3');
      });
    });

    describe('Europe (sxb1)', () => {
      it('should return sxb1 for de-DE', () => {
        expect(getDatacenterFromMarketId('de-DE')).toBe('sxb1');
      });

      it('should return sxb1 for fr-FR', () => {
        expect(getDatacenterFromMarketId('fr-FR')).toBe('sxb1');
      });

      it('should return sxb1 for en-GB', () => {
        expect(getDatacenterFromMarketId('en-GB')).toBe('sxb1');
      });

      it('should return sxb1 for es-ES', () => {
        expect(getDatacenterFromMarketId('es-ES')).toBe('sxb1');
      });

      it('should return sxb1 for it-IT', () => {
        expect(getDatacenterFromMarketId('it-IT')).toBe('sxb1');
      });

      it('should return sxb1 for nl-NL', () => {
        expect(getDatacenterFromMarketId('nl-NL')).toBe('sxb1');
      });
    });

    describe('Asia (sxb1)', () => {
      it('should return sxb1 for ja-JP', () => {
        expect(getDatacenterFromMarketId('ja-JP')).toBe('sxb1');
      });

      it('should return sxb1 for zh-CN', () => {
        expect(getDatacenterFromMarketId('zh-CN')).toBe('sxb1');
      });

      it('should return sxb1 for ko-KR', () => {
        expect(getDatacenterFromMarketId('ko-KR')).toBe('sxb1');
      });

      it('should return sxb1 for hi-IN', () => {
        expect(getDatacenterFromMarketId('hi-IN')).toBe('sxb1');
      });
    });

    describe('South America (p3)', () => {
      it('should return p3 for pt-BR', () => {
        expect(getDatacenterFromMarketId('pt-BR')).toBe('p3');
      });

      it('should return p3 for es-AR', () => {
        expect(getDatacenterFromMarketId('es-AR')).toBe('p3');
      });

      it('should return p3 for es-CL', () => {
        expect(getDatacenterFromMarketId('es-CL')).toBe('p3');
      });
    });

    describe('Oceania (p3)', () => {
      it('should return p3 for en-AU', () => {
        expect(getDatacenterFromMarketId('en-AU')).toBe('p3');
      });

      it('should return p3 for en-NZ', () => {
        expect(getDatacenterFromMarketId('en-NZ')).toBe('p3');
      });
    });

    describe('Africa (sxb1)', () => {
      it('should return sxb1 for en-ZA', () => {
        expect(getDatacenterFromMarketId('en-ZA')).toBe('sxb1');
      });

      it('should return sxb1 for ar-EG', () => {
        expect(getDatacenterFromMarketId('ar-EG')).toBe('sxb1');
      });
    });

    describe('default fallback (p3)', () => {
      it('should return p3 when marketId is undefined', () => {
        expect(getDatacenterFromMarketId(undefined)).toBe('p3');
      });

      it('should return p3 when marketId is empty string', () => {
        expect(getDatacenterFromMarketId('')).toBe('p3');
      });

      it('should return p3 for unknown country code', () => {
        expect(getDatacenterFromMarketId('en-XX')).toBe('p3');
      });

      it('should return p3 for malformed marketId with unknown country', () => {
        // 'xx-QQ' extracts 'QQ' which is not a valid country code
        expect(getDatacenterFromMarketId('xx-QQ')).toBe('p3');
      });

      it('should return p3 for short marketId', () => {
        expect(getDatacenterFromMarketId('en')).toBe('p3');
      });
    });

    describe('case insensitivity', () => {
      it('should handle lowercase marketId', () => {
        expect(getDatacenterFromMarketId('en-us')).toBe('p3');
      });

      it('should handle mixed case marketId', () => {
        expect(getDatacenterFromMarketId('En-Us')).toBe('p3');
      });

      it('should handle uppercase marketId', () => {
        expect(getDatacenterFromMarketId('EN-US')).toBe('p3');
      });
    });
  });
});
