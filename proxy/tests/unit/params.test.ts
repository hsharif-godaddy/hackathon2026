import { normalizePage, normalizePageSize } from '../../src/utils/paramNormalization.js';

describe('Parameter Normalization', () => {
  describe('normalizePage', () => {
    it('should normalize page=0 to page=1', () => {
      expect(normalizePage('0')).toBe(1);
    });

    it('should normalize negative page to page=1', () => {
      expect(normalizePage('-5')).toBe(1);
    });

    it('should keep valid page numbers', () => {
      expect(normalizePage('5')).toBe(5);
    });

    it('should default invalid page to 1', () => {
      expect(normalizePage('invalid')).toBe(1);
    });

    it('should default undefined to 1', () => {
      expect(normalizePage(undefined)).toBe(1);
    });
  });

  describe('normalizePageSize', () => {
    it('should cap pageSize at 100 maximum', () => {
      expect(normalizePageSize('1000')).toBe(100);
    });

    it('should default pageSize=0 to 25 (due to falsy check)', () => {
      expect(normalizePageSize('0')).toBe(25);
    });

    it('should keep valid pageSize values', () => {
      expect(normalizePageSize('50')).toBe(50);
    });

    it('should default invalid pageSize to 25', () => {
      expect(normalizePageSize('invalid')).toBe(25);
    });

    it('should normalize negative pageSize to 1', () => {
      expect(normalizePageSize('-10')).toBe(1);
    });

    it('should cap pageSize=150 to 100', () => {
      expect(normalizePageSize('150')).toBe(100);
    });

    it('should default undefined to 25', () => {
      expect(normalizePageSize(undefined)).toBe(25);
    });
  });
});
