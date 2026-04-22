import { z } from 'zod';

/**
 * Zod schemas for GoDaddy Commerce API response validation.
 *
 * IMPORTANT: Do NOT use .passthrough() on any schema. Zod v4's
 * .passthrough() causes "Maximum call stack size exceeded" when
 * validating large or deeply nested API responses. We only validate
 * the fields our code consumes; extra fields are silently stripped.
 */

export const StoreSummarySchema = z.object({
  storeId: z.string().optional(),
  storeName: z.string().optional(),
  channelId: z.string().optional(),
});

export const OnboardingResponseSchema = z.object({
  metadata: z.object({
    storeId: z.string(),
    channelId: z.string().optional(),
    businessId: z.string().optional(),
  }),
});

export const SkuGroupsResponseSchema = z.object({
  data: z.object({
    skuGroups: z.object({
      edges: z.array(z.record(z.string(), z.unknown())),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        hasPreviousPage: z.boolean().optional(),
        startCursor: z.string().nullable().optional(),
        endCursor: z.string().nullable().optional(),
      }),
      totalCount: z.number().optional(),
    }),
  }),
});

const OrderSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
});

const OrderLinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
});

export const OrdersResponseSchema = z.object({
  orders: z.array(OrderSchema),
  links: z.array(OrderLinkSchema).optional(),
});

export const GraphQLErrorSchema = z.object({
  errors: z.array(z.object({
    message: z.string(),
  })),
});
