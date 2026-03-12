import { describe, it, expect } from 'vitest';
import {
  StoreSummarySchema,
  OnboardingResponseSchema,
  SkuGroupsResponseSchema,
  OrdersResponseSchema,
} from '../godaddy-commerce-schemas.js';

describe('Commerce API Response Schemas', () => {
  describe('StoreSummarySchema', () => {
    it('should parse valid store summary', () => {
      const result = StoreSummarySchema.safeParse({
        storeId: 'store-123',
        storeName: 'My Store',
      });
      expect(result.success).toBe(true);
    });

    it('should accept missing storeId (no store found case)', () => {
      const result = StoreSummarySchema.safeParse({ storeName: 'test' });
      expect(result.success).toBe(true);
    });
  });

  describe('OnboardingResponseSchema', () => {
    it('should parse valid onboarding response', () => {
      const result = OnboardingResponseSchema.safeParse({
        metadata: {
          storeId: 'store-456',
          channelId: 'channel-789',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject response without metadata.storeId', () => {
      const result = OnboardingResponseSchema.safeParse({ metadata: {} });
      expect(result.success).toBe(false);
    });
  });

  describe('SkuGroupsResponseSchema', () => {
    it('should parse valid product catalog response', () => {
      const result = SkuGroupsResponseSchema.safeParse({
        data: {
          skuGroups: {
            edges: [{
              node: {
                id: 'grp-1',
                label: 'T-Shirt',
                skus: { edges: [{ node: { id: 'sku-1', code: 'TS-1' } }] },
              },
              cursor: 'abc',
            }],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('OrdersResponseSchema', () => {
    it('should parse valid orders response', () => {
      const result = OrdersResponseSchema.safeParse({
        orders: [{ id: 'order-1', status: 'OPEN' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty orders array', () => {
      const result = OrdersResponseSchema.safeParse({ orders: [] });
      expect(result.success).toBe(true);
    });
  });
});
