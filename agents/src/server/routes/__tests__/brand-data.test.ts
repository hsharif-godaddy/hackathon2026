import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

// Hoist mocks to top level
const {
  mockMemoryGet,
  mockParseBrandPersonality, mockParseBrandVoice, mockExtractTagline,
  mockParseBrandIconography, mockParseBrandLayout, mockParseBrandAudience,
} = vi.hoisted(() => ({
  mockMemoryGet: vi.fn(),
  mockParseBrandPersonality: vi.fn(),
  mockParseBrandVoice: vi.fn(),
  mockExtractTagline: vi.fn(),
  mockParseBrandIconography: vi.fn(),
  mockParseBrandLayout: vi.fn(),
  mockParseBrandAudience: vi.fn(),
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: vi.fn(() => ({
    get: mockMemoryGet,
  })),
}));

// Mock validateAppOwnership as passthrough
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock logging
vi.mock('../../../logging/index.js', () => ({
  log: {
    forApp: vi.fn().mockReturnValue({}),
    error: vi.fn(),
  },
}));

// Mock brand-data-parsers
vi.mock('../../../utils/brand-data-parsers.js', () => ({
  parseBrandPersonality: mockParseBrandPersonality,
  parseBrandVoice: mockParseBrandVoice,
  extractTagline: mockExtractTagline,
  parseBrandIconography: mockParseBrandIconography,
  parseBrandLayout: mockParseBrandLayout,
  parseBrandAudience: mockParseBrandAudience,
}));

import brandDataRouter from '../brand-data.js';

describe('Brand Data Route', () => {
  let app: Express;
  const testAppId = 'test-app-1';

  const noResult = { success: true, exists: false };

  function memoryResult(value: unknown) {
    return { success: true, exists: true, value };
  }

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(brandDataRouter);
    vi.clearAllMocks();

    // Re-set parser mock return values after clearAllMocks
    mockParseBrandPersonality.mockReturnValue({ description: 'parsed personality', traits: [] });
    mockParseBrandVoice.mockReturnValue({ weAre: ['friendly'], weAreNot: ['cold'] });
    mockExtractTagline.mockReturnValue('parsed tagline');
    mockParseBrandIconography.mockReturnValue({ style: 'minimal', tags: ['outlined', 'geometric'] });
    mockParseBrandLayout.mockReturnValue({ grid: '12-column', spacing: 'compact', components: 'cards, navigation, hero' });
    mockParseBrandAudience.mockReturnValue({ description: 'parsed audience' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /apps/:id/brand-data', () => {
    it('should return full BrandData when all structured data exists in memory', async () => {
      const palette = { primary: '#FF0000', secondary: '#00FF00', accent: '#0000FF' };
      const typography = { headingFont: 'Inter', bodyFont: 'Roboto' };
      const identity = {
        personality: { description: 'Bold', traits: [{ name: 'bold', description: 'Bold brand' }] },
        voice: { weAre: ['confident'], weAreNot: ['timid'] },
        tagline: 'Just do it',
        audience: { description: 'Young professionals' },
        iconography: { style: 'outlined', tags: ['geometric'] },
        layout: { grid: '12-column', spacing: 'compact', components: 'cards, navigation, hero' },
        photography: { style: 'vibrant', subjects: ['people'], avoid: ['stock'] },
        mission: { statement: 'To inspire', story: 'Founded to make a difference', values: ['Innovation'] },
        toneMatrix: [{ context: 'social', tone: 'casual' }],
      };

      // Set up memory.get to return values based on key
      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        const map: Record<string, unknown> = {
          'brand.colors.palette': palette,
          'brand.typography': typography,
          'brand.identity': identity,
        };
        if (key in map) return Promise.resolve(memoryResult(map[key]));
        return Promise.resolve(noResult);
      });

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        version: 2,
        brandName: 'Your Brand',
        palette,
        typography,
        personality: identity.personality,
        voice: identity.voice,
        tagline: identity.tagline,
        audience: identity.audience,
        iconography: identity.iconography,
        layout: identity.layout,
        photography: identity.photography,
        mission: identity.mission,
        toneMatrix: { contexts: identity.toneMatrix },
      });
    });

    it('should fall back to parsed markdown when no structured identity data exists', async () => {
      const palette = { primary: '#111', secondary: '#222' };

      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        const map: Record<string, unknown> = {
          'brand.colors.palette': palette,
          'design.brand-personality': '## Personality\nBold and creative',
          'design.voice-messaging': '## Voice\nWe are friendly\n## Tagline\nBe yourself',
          'design.iconography': '## Iconography\nMinimal icons',
          'design.layout': '## Layout\nModern grid',
          'design.audience': '## Audience\nYoung adults',
        };
        if (key in map) return Promise.resolve(memoryResult(map[key]));
        return Promise.resolve(noResult);
      });

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body.version).toBe(2);
      expect(response.body.brandName).toBe('Your Brand');
      expect(response.body.palette).toEqual(palette);
      // Falls back to parsed markdown
      expect(response.body.personality).toEqual({ description: 'parsed personality', traits: [] });
      expect(response.body.voice).toEqual({ weAre: ['friendly'], weAreNot: ['cold'] });
      expect(response.body.tagline).toBe('parsed tagline');
      expect(response.body.iconography).toEqual({ style: 'minimal', tags: ['outlined', 'geometric'] });
      expect(response.body.layout).toEqual({ grid: '12-column', spacing: 'compact', components: 'cards, navigation, hero' });
      expect(response.body.audience).toEqual({ description: 'parsed audience' });
      // No structured identity fields
      expect(response.body.photography).toBeUndefined();
      expect(response.body.mission).toBeUndefined();
      expect(response.body.toneMatrix).toBeUndefined();
    });

    it('should return Your Brand default when no memory keys exist', async () => {
      mockMemoryGet.mockResolvedValue(noResult);

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body.version).toBe(2);
      expect(response.body.brandName).toBe('Your Brand');
    });

    it('should return 500 when an internal error occurs', async () => {
      mockMemoryGet.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read brand data' });
    });

    it('should handle partial data when only some memory keys exist', async () => {
      const palette = { primary: '#ABC', secondary: '#DEF' };

      // Only palette exists, nothing else
      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        if (key === 'brand.colors.palette') {
          return Promise.resolve(memoryResult(palette));
        }
        return Promise.resolve(noResult);
      });

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        version: 2,
        brandName: 'Your Brand',
        palette,
      });
      // All other fields should be absent (undefined is omitted in JSON)
      expect(response.body.typography).toBeUndefined();
      expect(response.body.personality).toBeUndefined();
      expect(response.body.voice).toBeUndefined();
      expect(response.body.tagline).toBeUndefined();
      expect(response.body.iconography).toBeUndefined();
      expect(response.body.layout).toBeUndefined();
      expect(response.body.audience).toBeUndefined();
      expect(response.body.photography).toBeUndefined();
      expect(response.body.mission).toBeUndefined();
      expect(response.body.toneMatrix).toBeUndefined();
    });

    it('should wrap non-empty toneMatrix in { contexts } and omit when undefined', async () => {
      // Identity with empty toneMatrix array
      const identityEmpty = { toneMatrix: [] };
      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        if (key === 'brand.identity') return Promise.resolve({ success: true, exists: true, value: identityEmpty });
        return Promise.resolve(noResult);
      });

      const resEmpty = await request(app).get(`/apps/${testAppId}/brand-data`);
      expect(resEmpty.status).toBe(200);
      expect(resEmpty.body.toneMatrix).toEqual({ contexts: [] });

      const identityNo = { personality: { description: 'Bold' } };
      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        if (key === 'brand.identity') return Promise.resolve({ success: true, exists: true, value: identityNo });
        return Promise.resolve(noResult);
      });

      const resUndef = await request(app).get(`/apps/${testAppId}/brand-data`);
      expect(resUndef.status).toBe(200);
      expect(resUndef.body.toneMatrix).toBeUndefined();
    });

    it('should prefer brandName from brand.identity when present', async () => {
      const identity = { brandName: 'Memory Brand Name' };

      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        if (key === 'brand.identity') return Promise.resolve(memoryResult(identity));
        return Promise.resolve(noResult);
      });

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body.brandName).toBe('Memory Brand Name');
    });

    it('should default to Your Brand when brand.identity has no brandName', async () => {
      const identity = { personality: { description: 'Bold' } };

      mockMemoryGet.mockImplementation((_scope: unknown, key: string) => {
        if (key === 'brand.identity') return Promise.resolve(memoryResult(identity));
        return Promise.resolve(noResult);
      });

      const response = await request(app).get(`/apps/${testAppId}/brand-data`);

      expect(response.status).toBe(200);
      expect(response.body.brandName).toBe('Your Brand');
    });
  });
});
