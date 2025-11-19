import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { AuthService, AuthRequiredError } from '../../services/auth-service.js';
import { GoDaddyCommerce, type CreateSkuGroupInput } from '../../lib/godaddy-commerce.js';
import { getCustomerIdFromAccessToken } from '../../utils/oauth-claims.js';
import { logger } from '../../logging/index.js';
import { ok, needAuth, fail, ErrorCodes } from '../tool-response.js';

const godaddy = new GoDaddyCommerce();

export interface Product {
  id: string;
  label: string;
  description?: string;
  type: string;
  priceRange?: string;
  compareAtPriceRange?: string;
  skus?: {
    id: string;
    name: string;
    code: string;
  }[];
}

export const commerceGetStore = createTool(
  "Get a customer's store summary. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. Use this to check if a user is onboarded onto GoDaddy Commerce.",
  z.object({
    responseFormat: z.enum(['concise', 'detailed']).default('concise').describe('Response detail level'),
  }),
  async (input, context) => {
    const startTime = Date.now();
    const appId = context?.metadata?.appId as string;
    
    if (!appId) {
      return fail({
        code: ErrorCodes.CONTEXT_MISSING,
        message: 'App ID is required for commerce operations',
        hint: 'Pass context.metadata.appId',
      });
    }

    try {
      const { accessToken } = await AuthService.getAccessToken({ appId });
      const customerId = getCustomerIdFromAccessToken(accessToken);
      const summary = await godaddy.getStoreSummary({ customerId }, accessToken);

      return ok(summary, {
        tookMs: Date.now() - startTime,
        responseFormat: input.responseFormat,
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return needAuth(
          {
            code: ErrorCodes.AUTH_REQUIRED,
            message: 'Authentication required to proceed.',
          },
          {
            auth: {
              provider: 'godaddy',
              scopes: err.scopes,
              redirectUrl: err.redirectUrl,
              state: err.state,
            },
          },
          { responseFormat: input.responseFormat }
        );
      }
      throw err;
    }
  }
);

export const commerceSetupStore = createTool(
  'Setup a new commerce store for a user. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. Use when user wants to create or onboard a commerce store.',
  z.object({
    firstName: z.string().describe('The first name of the user'),
    lastName: z.string().describe('The last name of the user'),
    email: z.string().email().describe('The email address of the user'),
    responseFormat: z.enum(['concise', 'detailed']).default('concise').describe('Response detail level'),
  }),
  async (input, context) => {
    const startTime = Date.now();
    const appId = context?.metadata?.appId as string;
    
    if (!appId) {
      return fail({
        code: ErrorCodes.CONTEXT_MISSING,
        message: 'App ID is required for commerce operations',
        hint: 'Pass context.metadata.appId',
      });
    }

    logger.info('commerce.onboarding.start', {
      appId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
    });

    try {
      const { accessToken } = await AuthService.getAccessToken({ appId });
      const customerId = getCustomerIdFromAccessToken(accessToken);
      const result = await godaddy.onboardApplication({ appId, customerId, ...input }, accessToken);
      
      return ok(result, {
        tookMs: Date.now() - startTime,
        responseFormat: input.responseFormat,
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        logger.info('commerce.onboarding.auth.required', { appId, scopes: err.scopes });
        return needAuth(
          {
            code: ErrorCodes.AUTH_REQUIRED,
            message: 'Authentication required to proceed.',
          },
          {
            auth: {
              provider: 'godaddy',
              scopes: err.scopes,
              redirectUrl: err.redirectUrl,
              state: err.state,
            },
          },
          { responseFormat: input.responseFormat }
        );
      }

      logger.error('commerce.onboarding.failure', {
        appId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }
);

/**
 * Get Products Tool for AI-Lib
 * Fetch product catalog from GoDaddy Commerce API with pagination support
 */
export const commerceSearchStoreProducts = createTool(
  'Search products from commerce store. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. Supports pagination for large catalogs.',
  z.object({
    storeId: z.string().describe('The store ID to fetch products from'),
    first: z.number().int().min(1).max(50).default(20).describe('Number of products to fetch (1-50)'),
    after: z.string().optional().describe('Pagination cursor from previous response'),
    query: z.string().optional().describe('Filter products by text query'),
    responseFormat: z.enum(['concise', 'detailed']).default('concise').describe('Response detail level'),
  }),
  async (input, context) => {
    const startTime = Date.now();
    const appId = context?.metadata?.appId as string;
    
    if (!appId) {
      return fail({
        code: ErrorCodes.CONTEXT_MISSING,
        message: 'App ID is required for commerce operations',
        hint: 'Pass context.metadata.appId',
      });
    }

    try {
      const { accessToken } = await AuthService.getAccessToken({ appId });
      const result = await godaddy.getSkuGroups({ storeId: input.storeId }, accessToken);

      if (!result.success) {
        return fail({
          code: ErrorCodes.OPERATION_FAILED,
          message: result.error || 'Failed to fetch products from commerce API',
          retryable: true,
        });
      }

      const graphqlData = result.data;
      const products: Product[] = [];

      if (graphqlData?.skuGroups?.edges) {
        for (const groupEdge of graphqlData.skuGroups.edges) {
          const group = groupEdge.node;

          const product: Product = {
            id: group.id,
            label: group.label,
            description: group.description,
            type: group.type,
            skus: group?.skus?.edges?.map((skuEdge: any) => ({
              id: skuEdge.node.id,
              name: skuEdge.node.name,
              code: skuEdge.node.code,
            })),
          };

          if (group.priceRange) {
            product.priceRange = `${group.priceRange.min} - ${group.priceRange.max}`;
          }

          if (group.compareAtPriceRange) {
            product.compareAtPriceRange = `${group.compareAtPriceRange.min} - ${group.compareAtPriceRange.max}`;
          }

          products.push(product);
        }
      }

      // Format response based on responseFormat
      const responseData = input.responseFormat === 'concise'
        ? {
            products: products.map(p => ({
              label: p.label,
              priceRange: p.priceRange,
              skuCount: p.skus?.length ?? 0,
            }))
          }
        : { products };

      return ok(responseData, {
        tookMs: Date.now() - startTime,
        responseFormat: input.responseFormat,
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return needAuth(
          {
            code: ErrorCodes.AUTH_REQUIRED,
            message: 'Authentication required to proceed.',
          },
          {
            auth: {
              provider: 'godaddy',
              scopes: err.scopes,
              redirectUrl: err.redirectUrl,
              state: err.state,
            },
          },
          { responseFormat: input.responseFormat }
        );
      }
      throw err;
    }
  }
);

export const commerceAddStoreProducts = createTool(
  'Create a product in GoDaddy Commerce store. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. At least one SKU variant is required.',
  z.object({
    storeId: z.string().describe('The store ID where the product will be created'),
    product: z.object({
      label: z.string().describe('The display name of the product (e.g., "Burrito")'),
      name: z
        .string()
        .optional()
        .describe('Unique identifier/slug for the product (e.g., "burrito")'),
      type: z
        .enum(['PHYSICAL', 'DIGITAL'])
        .describe('Product type: "PHYSICAL" or "DIGITAL"')
        .default('PHYSICAL'),
      status: z
        .enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
        .optional()
        .describe('Product status (defaults to ACTIVE)')
        .default('ACTIVE'),
      description: z.string().optional().describe('Short description of the product'),
      skus: z
        .array(
          z.object({
            label: z.string().describe('Display name for this SKU variant'),
            name: z.string().optional().describe('Unique identifier for this SKU'),
            status: z
              .enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
              .optional()
              .describe('SKU status')
              .default('ACTIVE'),
            code: z.string().optional().describe('SKU code/barcode'),
            description: z.string().optional().describe('SKU description'),
            prices: z
              .array(
                z.object({
                  value: z.object({
                    currencyCode: z.string().length(3).transform(v => v.toUpperCase()).describe('3-letter currency code (e.g., "USD")'),
                    value: z.number().int().describe('Price amount in cents (e.g., 1500 for $15.00)'),
                  }),
                  compareAtValue: z
                    .object({
                      currencyCode: z.string().length(3).transform(v => v.toUpperCase()),
                      value: z.number().int().describe('Original/compare-at price in cents'),
                    })
                    .optional()
                    .describe('Original/compare-at price'),
                })
              )
              .optional()
              .describe('Array of prices for this SKU'),
            weight: z.number().optional().describe('Weight value'),
            unitOfWeight: z.enum(['KG', 'GR', 'LB', 'OZ']).optional().describe('Weight unit'),
          })
        )
        .min(1, 'At least one SKU variant is required')
        .optional()
        .describe('Array of SKU variants for this product'),
    }),
    responseFormat: z.enum(['concise', 'detailed']).default('concise').describe('Response detail level'),
    dryRun: z.boolean().default(false).describe('Validate inputs without creating product'),
  }),
  async (input, context) => {
    const startTime = Date.now();
    const appId = context?.metadata?.appId as string;
    
    if (!appId) {
      return fail({
        code: ErrorCodes.CONTEXT_MISSING,
        message: 'App ID is required for commerce operations',
        hint: 'Pass context.metadata.appId',
      });
    }

    // Dry run mode: validate and return plan without creating
    if (input.dryRun) {
      return ok(
        {
          plan: {
            action: 'create_product',
            storeId: input.storeId,
            productLabel: input.product.label,
            skuCount: input.product.skus?.length ?? 0,
          },
          created: false,
        },
        { responseFormat: input.responseFormat }
      );
    }

    try {
      const { accessToken } = await AuthService.getAccessToken({ appId });

      const result = await godaddy.createSkuGroup(
        { storeId: input.storeId, product: input.product as CreateSkuGroupInput },
        accessToken
      );

      if (!result.success) {
        return fail({
          code: ErrorCodes.OPERATION_FAILED,
          message: result.error || 'Failed to create product',
          retryable: true,
        });
      }

      const productData = result.data.createSkuGroup;

      const product: Product = {
        id: productData.id,
        label: productData.label,
        ...(productData.description && { description: productData.description }),
        type: productData.type,
        ...(productData.priceRange && {
          priceRange: `$${productData.priceRange.min} - $${productData.priceRange.max}`,
        }),
        ...(productData?.skus?.edges && {
          skus: productData.skus.edges.map((sku: any) => ({
            id: sku.node.id,
            label: sku.node.label,
            name: sku.node.name,
            code: sku.node.code,
            status: sku.node.status,
          })),
        }),
      };

      const responseData = input.responseFormat === 'concise'
        ? {
            message: `Successfully created product: ${productData.label}`,
            productId: productData.id,
          }
        : {
            message: `Successfully created product: ${productData.label}`,
            product,
          };

      return ok(responseData, {
        tookMs: Date.now() - startTime,
        responseFormat: input.responseFormat,
      });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return needAuth(
          {
            code: ErrorCodes.AUTH_REQUIRED,
            message: 'Authentication required to proceed.',
          },
          {
            auth: {
              provider: 'godaddy',
              scopes: err.scopes,
              redirectUrl: err.redirectUrl,
              state: err.state,
            },
          },
          { responseFormat: input.responseFormat }
        );
      }
      throw err;
    }
  }
);
