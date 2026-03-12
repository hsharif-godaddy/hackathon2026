import { z } from 'zod';

/**
 * Zod schemas for GoDaddy Commerce API response validation.
 * Uses .passthrough() on objects so extra fields don't cause failures.
 */

export const StoreSummarySchema = z.object({
  storeId: z.string().optional(),
  storeName: z.string().optional(),
  channelId: z.string().optional(),
}).passthrough();

export const OnboardingResponseSchema = z.object({
  metadata: z.object({
    storeId: z.string(),
    channelId: z.string().optional(),
    businessId: z.string().optional(),
  }).passthrough(),
}).passthrough();

const SkuGroupNodeSchema = z.object({
  id: z.string(),
  label: z.string().nullable().optional(),
}).passthrough();

export const SkuGroupsResponseSchema = z.object({
  data: z.object({
    skuGroups: z.object({
      edges: z.array(z.object({
        node: SkuGroupNodeSchema,
        cursor: z.string().optional(),
      }).passthrough()),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
      }).passthrough(),
      totalCount: z.number().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const OrderSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
}).passthrough();

export const OrdersResponseSchema = z.object({
  orders: z.array(OrderSchema),
}).passthrough();

export const GraphQLErrorSchema = z.object({
  errors: z.array(z.object({
    message: z.string(),
  }).passthrough()),
}).passthrough();
