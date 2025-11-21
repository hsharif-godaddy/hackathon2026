import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { AuthService, AuthRequiredError } from '../../services/auth-service.js';
import {
  GoDaddyCommerce,
  type CreateSkuGroupInput,
  type UpdateSkuGroupInput,
} from '../../lib/godaddy-commerce.js';
import { getCustomerIdFromAccessToken } from '../../utils/oauth-claims.js';
import { logger } from '../../logging/index.js';
import { ok, needAuth, fail, ErrorCodes } from '../tool-response.js';
import type { CommerceOnboardingApplicationResponse } from '../../lib/godaddy-commerce-types.js';

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

export const commerceStore = createTool(
  "Manage a customer's store. Supports Read operation via \"action\" parameter. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed.",
  z.object({
    action: z.enum(['read']).describe('Action to perform'),
    responseFormat: z
      .enum(['concise', 'detailed'])
      .default('concise')
      .describe('Response detail level'),
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

      if (input.action === 'read') {
        const customerId = getCustomerIdFromAccessToken(accessToken);
        const summary = await godaddy.getStoreSummary({ customerId }, accessToken);

        return ok(summary, {
          tookMs: Date.now() - startTime,
          responseFormat: input.responseFormat,
        });
      }

      return fail({
        code: ErrorCodes.INVALID_INPUT,
        message: 'Invalid action',
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

export const commerceSetupIntegration = createTool(
  'Setup a new commerce store for a user. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. Use when user wants to create or onboard a commerce store.',
  z.object({
    firstName: z
      .string()
      .optional()
      .describe('The first name of the user (required if storeId is not provided)'),
    lastName: z
      .string()
      .optional()
      .describe('The last name of the user (required if storeId is not provided)'),
    email: z
      .string()
      .email()
      .optional()
      .describe('The email address of the user (required if storeId is not provided)'),
    storeName: z
      .string()
      .optional()
      .describe('The name of the store (required if storeId is not provided)'),
    storeId: z
      .string()
      .optional()
      .describe('The store ID of the user (use this if the store already exists)'),
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
      let onboardResult: CommerceOnboardingApplicationResponse;

      if (!input.storeId) {
        // Validate required fields for onboarding
        if (!input.firstName || !input.lastName || !input.email) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Either storeId OR (firstName, lastName, email) must be provided.',
          });
        }

        logger.info('commerce.onboarding.start', {
          appId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
        });

        onboardResult = await godaddy.onboardApplication(
          {
            appId,
            customerId,
            storeName: input.storeName,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
          },
          accessToken
        );

        if (!onboardResult.metadata.storeId) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: 'Failed to setup commerce store',
            hint: 'Check the logs for more details',
          });
        }

        await godaddy.enableGoDaddyPaymentsApplication(
          { storeId: onboardResult?.metadata?.storeId },
          accessToken
        );

        return ok(onboardResult, {
          tookMs: Date.now() - startTime,
        });
      } else {
        const response = await godaddy.enableGoDaddyPaymentsApplication(
          { storeId: input.storeId },
          accessToken
        );

        return ok(response, {
          tookMs: Date.now() - startTime,
        });
      }
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
          }
        );
      }

      logger.error('commerce.onboarding.failure', {
        appId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return fail({
        code: ErrorCodes.OPERATION_FAILED,
        message: 'Failed to setup commerce store',
        hint: 'Check the logs for more details',
      });
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
    first: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Number of products to fetch (1-50)'),
    after: z.string().optional().describe('Pagination cursor from previous response'),
    query: z.string().optional().describe('Filter products by text query'),
    responseFormat: z
      .enum(['concise', 'detailed'])
      .default('concise')
      .describe('Response detail level'),
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
            ...(group.description && { description: group.description }),
            type: group.type,
            ...(group?.skus?.edges && {
              skus: group.skus.edges.map((skuEdge: any) => ({
                id: skuEdge.node.id,
                name: skuEdge.node.name,
                code: skuEdge.node.code,
              })),
            }),
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
      const responseData =
        input.responseFormat === 'concise'
          ? {
              products: products.map((p) => ({
                label: p.label,
                priceRange: p.priceRange,
                skuCount: p.skus?.length ?? 0,
              })),
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

export const commerceProduct = createTool(
  'Manage a single product in GoDaddy Commerce store. Supports Create, Read, Update, Delete operations via "action" parameter. Requires context.metadata.appId. For searching/listing multiple products, use "searchProducts" tool.',
  z.object({
    action: z.enum(['create', 'read', 'update', 'delete']).describe('Action to perform'),
    storeId: z.string().describe('The store ID'),
    productId: z.string().optional().describe('The ID of the product (required for read, update, delete)'),
    product: z
      .object({
        label: z.string().optional().describe('The display name of the product (required for create)'),
        name: z
          .string()
          .optional()
          .describe('Unique identifier/slug for the product (e.g., "burrito")'),
        type: z
          .enum(['PHYSICAL', 'DIGITAL'])
          .optional()
          .describe('Product type: "PHYSICAL" or "DIGITAL" (defaults to PHYSICAL for create)'),
        status: z
          .enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
          .optional()
          .describe('Product status (defaults to ACTIVE)'),
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
                      currencyCode: z
                        .string()
                        .length(3)
                        .transform((v) => v.toUpperCase())
                        .describe('3-letter currency code (e.g., "USD")'),
                      value: z
                        .number()
                        .int()
                        .describe('Price amount in cents (e.g., 1500 for $15.00)'),
                    }),
                    compareAtValue: z
                      .object({
                        currencyCode: z
                          .string()
                          .length(3)
                          .transform((v) => v.toUpperCase()),
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
          .optional()
          .describe('Array of SKU variants for this product (required for create)'),
      })
      .optional()
      .describe('Product details for create/update actions'),
    responseFormat: z
      .enum(['concise', 'detailed'])
      .default('concise')
      .describe('Response detail level'),
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

    try {
      const { accessToken } = await AuthService.getAccessToken({ appId });

      if (input.action === 'create') {
        if (!input.product) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product details are required for create action',
          });
        }
        if (!input.product.label) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product label is required for create action',
          });
        }
        
        // Prepare product input with defaults
        const productInput = {
            ...input.product,
            type: input.product.type || 'PHYSICAL',
            status: input.product.status || 'ACTIVE',
            label: input.product.label,
            skus: input.product.skus
        };

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

        const result = await godaddy.createSkuGroup(
          { storeId: input.storeId, product: productInput as CreateSkuGroupInput },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to create product',
            retryable: true,
          });
        }

        return ok(result.data, {
          tookMs: Date.now() - startTime,
          responseFormat: input.responseFormat,
        });
      }

      if (input.action === 'read') {
        if (!input.productId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product ID is required for read action',
            hint: 'Use commerceSearchStoreProducts to list or search for products',
          });
        }

        const result = await godaddy.getSkuGroup(
          { storeId: input.storeId, skuGroupId: input.productId },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to fetch product',
            retryable: true,
          });
        }

        let product = null;
        if (result.data?.skuGroup) {
          product = result.data.skuGroup;
        } else {
          return fail({
            code: ErrorCodes.NOT_FOUND,
            message: 'Product not found',
          });
        }

        return ok(
          { product },
          {
            tookMs: Date.now() - startTime,
            responseFormat: input.responseFormat,
          }
        );
      }

      if (input.action === 'update') {
        if (!input.productId) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product ID is required for update action',
          });
        }
        if (!input.product) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product details are required for update action',
          });
        }

        const updateInput: UpdateSkuGroupInput = {
          ...(input.product.label && { label: input.product.label }),
          ...(input.product.name && { name: input.product.name }),
          ...(input.product.description && { description: input.product.description }),
          ...(input.product.status && { status: input.product.status }),
        };

        const result = await godaddy.updateSkuGroup(
          {
            storeId: input.storeId,
            skuGroupId: input.productId,
            product: updateInput,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to update product',
            retryable: true,
          });
        }

        return ok(
          {
            message: 'Successfully updated product',
            product: result.data.updateSkuGroup,
          },
          {
            tookMs: Date.now() - startTime,
            responseFormat: input.responseFormat,
          }
        );
      }

      if (input.action === 'delete') {
        if (!input.productId) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Product ID is required for delete action',
          });
        }

        const result = await godaddy.deleteSkuGroup(
          { storeId: input.storeId, skuGroupId: input.productId },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to delete product',
            retryable: true,
          });
        }

        return ok(
          {
            message: 'Successfully deleted product',
            productId: result.data.deleteSkuGroupById.id,
          },
          {
            tookMs: Date.now() - startTime,
            responseFormat: input.responseFormat,
          }
        );
      }

      return fail({
        code: ErrorCodes.INVALID_INPUT,
        message: 'Invalid action',
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

