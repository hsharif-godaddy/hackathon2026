import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { AuthService, AuthRequiredError } from '../../services/auth-service.js';
import {
  GoDaddyCommerce,
  type CreateSkuGroupInput,
  type UpdateSkuGroupInput,
  type UpdateSkuInput,
} from '../../lib/godaddy-commerce.js';
import { getCustomerIdFromAccessToken } from '../../utils/oauth-claims.js';
import { logger } from '../../logging/index.js';
import { ok, needAuth, fail, ErrorCodes } from '../tool-response.js';
import type { CommerceOnboardingApplicationResponse } from '../../lib/godaddy-commerce-types.js';

const godaddy = new GoDaddyCommerce();

export const commerceStore = createTool(
  "Manage a customer's store. Supports Read operation via \"action\" parameter. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed.",
  z.object({
    action: z.enum(['read']).describe('Action to perform'),
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
        const summary = await godaddy.getStoreSummary({ customerId }, accessToken) as { storeId?: string };

        return ok({
          ...summary,
          manageUrl: summary.storeId ? godaddy.getStoreManagementUrl(summary.storeId) : undefined,
        }, {
          tookMs: Date.now() - startTime,
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

        return ok({
          ...onboardResult,
          manageUrl: godaddy.getStoreManagementUrl(onboardResult.metadata.storeId),
        }, {
          tookMs: Date.now() - startTime,
        });
      } else {
        const response = await godaddy.enableGoDaddyPaymentsApplication(
          { storeId: input.storeId },
          accessToken
        );

        return ok({
          ...response,
          manageUrl: godaddy.getStoreManagementUrl(input.storeId),
        }, {
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

export const commerceSearchSkuGroups = createTool(
  'Search SKU Groups (products) from commerce store. Requires context.metadata.appId. Returns AUTH_REQUIRED when user authorization is needed. Supports pagination for large catalogs.',
  z.object({
    storeId: z.string().describe('The store ID to fetch SKU Groups from'),
    channelId: z.string().optional().describe('The channel ID to fetch SKU Groups from'),
    first: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Number of SKU Groups to fetch (1-50)'),
    after: z.string().optional().describe('Pagination cursor from previous response'),
    query: z.string().optional().describe('Filter SKU Groups by text query'),
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
      const result = await godaddy.getSkuGroups(
        {
          storeId: input.storeId,
          first: input.first,
          after: input.after,
          query: input.query,
        },
        accessToken
      );

      if (!result.success) {
        return fail({
          code: ErrorCodes.OPERATION_FAILED,
          message: result.error || 'Failed to fetch SKU Groups from commerce API',
          retryable: true,
        });
      }

      const responseData = {
        storeId: input.storeId,
        channelId: input.channelId,
        skuGroups: result.data.skuGroups,
        manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
      };

      return ok(responseData, {
        tookMs: Date.now() - startTime,
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
        );
      }
      throw err;
    }
  }
);

export const commerceSkuGroup = createTool(
  'Manage a single SKU Group (product) in GoDaddy Commerce store. Supports Create, Read, Update, Delete operations via "action" parameter. Requires context.metadata.appId. For searching/listing multiple SKU Groups, use "searchSkuGroups" tool.',
  z.object({
    action: z.enum(['create', 'read', 'update', 'delete']).describe('Action to perform'),
    storeId: z.string().describe('The store ID'),
    channelId: z.string().optional().describe('The channel ID'),
    skuGroupId: z.string().optional().describe('The ID of the SKU Group (required for read, update, delete)'),
    skuGroup: z
      .object({
        label: z.string().nullable().optional().describe('The display name of the SKU Group (required for create)'),
        name: z
          .string()
          .optional()
          .describe('Unique identifier/slug for the SKU Group (e.g., "burrito")'),
        type: z
          .enum(['PHYSICAL', 'DIGITAL'])
          .optional()
          .describe('SKU Group type: "PHYSICAL" or "DIGITAL" (defaults to PHYSICAL for create)'),
        status: z
          .enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
          .optional()
          .describe('SKU Group status (defaults to ACTIVE)'),
        description: z.string().optional().describe('Short description of the SKU Group'),
        skus: z
          .array(
            z.object({
              label: z.string().nullable().describe('Display name for this SKU variant'),
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
          .describe('Array of SKU variants for this SKU Group. SKUs are the purchasable unit (tshirt/black/small) vs a SKU Group, which is a presentational grouping of SKUs (T-Shirt) (required for create)'),
      })
      .optional()
      .describe('SKU Group (the presentational element of a grouping of SKUs, e.g. T-Shirt) details for create/update actions'),
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
        if (!input.skuGroup) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group details are required for create action',
          });
        }
        if (!input.skuGroup.label) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group label is required for create action',
          });
        }
        
        // Prepare product input with defaults
        const productInput = {
            ...input.skuGroup,
            type: input.skuGroup.type || 'PHYSICAL',
            status: input.skuGroup.status || 'ACTIVE',
            label: input.skuGroup.label,
            skus: input.skuGroup.skus
        };

        const result = await godaddy.createSkuGroup(
          { storeId: input.storeId, product: productInput as CreateSkuGroupInput },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to create SKU Group',
            retryable: true,
          });
        }

        const response = {
          storeId: input.storeId,
          channelId: input.channelId,
          skuGroup: result.data.createSkuGroup,
          manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
        }

        return ok(response, {
          tookMs: Date.now() - startTime,
        });
      }

      if (input.action === 'read') {
        if (!input.skuGroupId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group ID is required for read action',
            hint: 'Use commerceSearchSkuGroups to list or search for products',
          });
        }

        const result = await godaddy.getSkuGroup(
          { storeId: input.storeId, skuGroupId: input.skuGroupId },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to fetch SKU Group',
            retryable: true,
          });
        }

        return ok(
          { 
            storeId: input.storeId,
            channelId: input.channelId,
            skuGroup: result.data?.skuGroup,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'update') {
        if (!input.skuGroupId) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group ID is required for update action',
          });
        }
        if (!input.skuGroup) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group details are required for update action',
          });
        }

        const updateInput: UpdateSkuGroupInput = {
          ...(input?.skuGroup?.label && { label: input.skuGroup.label }),
          ...(input?.skuGroup?.name && { name: input.skuGroup.name }),
          ...(input?.skuGroup?.description && { description: input.skuGroup.description }),
          ...(input?.skuGroup?.status && { status: input.skuGroup.status }),
        };

        const result = await godaddy.updateSkuGroup(
          {
            storeId: input.storeId,
            skuGroupId: input.skuGroupId,
            product: updateInput,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to update SKU Group',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            channelId: input.channelId,
            skuGroup: result.data?.updateSkuGroup,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'delete') {
        if (!input.skuGroupId) {
           return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU Group ID is required for delete action',
          });
        }

        const result = await godaddy.deleteSkuGroup(
          { storeId: input.storeId, skuGroupId: input.skuGroupId },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to delete SKU Group',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            channelId: input.channelId,
            skuGroupId: result.data.deleteSkuGroupById,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
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
          }
        );
      }
      throw err;
    }
  }
);

export const commerceSku = createTool(
  'Manage a single SKU in GoDaddy Commerce store. Supports Update operation via "action" parameter. Use this to update inventory settings like backorder limit or tracking.',
  z.object({
    action: z.enum(['update']).describe('Action to perform'),
    storeId: z.string().describe('The store ID'),
    channelId: z.string().optional().describe('The channel ID'),
    skuId: z.string().describe('The ID of the SKU'),
    sku: z
      .object({
        label: z.string().optional().describe('The display name of the SKU'),
        name: z.string().optional().describe('Unique identifier for the SKU'),
        status: z
          .enum(['DRAFT', 'ACTIVE', 'ARCHIVED'])
          .optional()
          .describe('SKU status'),
        code: z.string().optional().describe('SKU code/barcode'),
        description: z.string().optional().describe('SKU description'),
        backorderLimit: z
          .number()
          .int()
          .optional()
          .describe(
            'The number of backorders allowed. Set to 0 to disable backorders. Set to null for unlimited.'
          ),
        disableInventoryTracking: z
          .boolean()
          .optional()
          .describe('Flag to mark whether stock should be tracked for the SKU'),
        disablePriceOverrides: z
          .boolean()
          .optional()
          .describe('Flag to mark whether or not a custom price can be provided'),
        disableShipping: z
          .boolean()
          .optional()
          .describe('Flag to mark whether the SKU should be shipped or not'),
        weight: z.number().optional().describe('Weight value'),
        unitOfWeight: z.enum(['KG', 'GR', 'LB', 'OZ']).optional().describe('Weight unit'),
        unitCost: z
          .object({
            currencyCode: z
              .string()
              .length(3)
              .transform((v) => v.toUpperCase())
              .describe('3-letter currency code (e.g., "USD")'),
            value: z
              .number()
              .describe('Cost amount'),
          })
          .optional()
          .describe('Cost of the SKU per unit'),
      })
      .describe('SKU details to update'),
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

      if (input.action === 'update') {
        if (!input.sku) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU details are required for update action',
          });
        }

        const updateInput: UpdateSkuInput = {
          ...(input?.sku?.label && { label: input.sku.label }),
          ...(input?.sku?.name && { name: input.sku.name }),
          ...(input?.sku?.description && { description: input.sku.description }),
          ...(input?.sku?.status && { status: input.sku.status }),
          ...(input?.sku?.code && { code: input.sku.code }),
          ...(input?.sku?.backorderLimit !== undefined && {
            backorderLimit: input.sku.backorderLimit,
          }),
          ...(input?.sku?.disableInventoryTracking !== undefined && {
            disableInventoryTracking: input.sku.disableInventoryTracking,
          }),
          ...(input?.sku?.disablePriceOverrides !== undefined && {
            disablePriceOverrides: input.sku.disablePriceOverrides,
          }),
          ...(input?.sku?.disableShipping !== undefined && {
            disableShipping: input.sku.disableShipping,
          }),
          ...(input?.sku?.weight !== undefined && { weight: input.sku.weight }),
          ...(input?.sku?.unitOfWeight && { unitOfWeight: input.sku.unitOfWeight }),
          ...(input?.sku?.unitCost && { unitCost: input.sku.unitCost }),
        };

        const result = await godaddy.updateSku(
          {
            storeId: input.storeId,
            skuId: input.skuId,
            product: updateInput,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to update SKU',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            channelId: input.channelId,
            sku: result.data?.updateSku,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
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
          }
        );
      }
      throw err;
    }
  }
);

export const commerceInventory = createTool(
  'Manage inventory levels for SKUs in GoDaddy Commerce store. Supports getLocations (discover available locations), createLocation (create new location), read (get current inventory), adjust (add/remove by delta), and stock (add new inventory) operations. Requires storeId, skuId, and locationId for most operations.',
  z.object({
    action: z.enum(['getLocations', 'createLocation', 'read', 'adjust', 'stock']).describe('Action to perform: getLocations lists available inventory locations, createLocation creates a new location, read gets current inventory, adjust modifies by delta (+/-), stock adds new inventory'),
    storeId: z.string().describe('The store ID'),
    skuId: z.string().optional().describe('The SKU ID (required for adjust and stock actions)'),
    locationId: z.string().optional().describe('The location ID (required for adjust and stock actions)'),
    quantity: z
      .number()
      .int()
      .optional()
      .describe('For adjust: the delta to apply (positive to add, negative to remove). For stock: the quantity to add.'),
    location: z
      .object({
        label: z.string().describe('Display name for the location (e.g., "Main Warehouse")'),
        name: z.string().optional().describe('Unique identifier for the location'),
        status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional().describe('Location status (defaults to ACTIVE)'),
        address: z.object({
          addressLine1: z.string().describe('Street address (required)'),
          addressLine2: z.string().optional().describe('Additional address line'),
          addressLine3: z.string().optional().describe('Additional address line'),
          adminArea1: z.string().optional().describe('City'),
          adminArea2: z.string().optional().describe('State/Province'),
          postalCode: z.string().optional().describe('Postal/ZIP code'),
          countryCode: z.string().length(2).describe('2-letter country code (e.g., "US")'),
        }).describe('Location address'),
      })
      .optional()
      .describe('Location details (required for createLocation action)'),
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

      if (input.action === 'getLocations') {
        const result = await godaddy.getLocations(
          {
            storeId: input.storeId,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to fetch locations',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            locations: result.data.locations,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'createLocation') {
        if (!input.location) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Location details are required for createLocation action',
          });
        }

        const locationInput = {
          label: input.location.label,
          address: {
            addressLine1: input.location.address.addressLine1,
            countryCode: input.location.address.countryCode,
            ...(input.location.address.addressLine2 && { addressLine2: input.location.address.addressLine2 }),
            ...(input.location.address.addressLine3 && { addressLine3: input.location.address.addressLine3 }),
            ...(input.location.address.adminArea1 && { adminArea1: input.location.address.adminArea1 }),
            ...(input.location.address.adminArea2 && { adminArea2: input.location.address.adminArea2 }),
            ...(input.location.address.postalCode && { postalCode: input.location.address.postalCode }),
          },
          ...(input.location.name && { name: input.location.name }),
          ...(input.location.status && { status: input.location.status }),
        };

        const result = await godaddy.createLocation(
          {
            storeId: input.storeId,
            location: locationInput,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to create location',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            location: result.data.createLocation,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'read') {
        const result = await godaddy.getInventoryCounts(
          {
            storeId: input.storeId,
            ...(input.skuId && { skuId: input.skuId }),
            ...(input.locationId && { locationId: input.locationId }),
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to fetch inventory counts',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            inventoryCounts: result.data.inventoryCounts,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'adjust') {
        if (!input.skuId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU ID is required for adjust action',
          });
        }
        if (!input.locationId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Location ID is required for adjust action',
          });
        }
        if (input.quantity === undefined) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Quantity (delta) is required for adjust action',
          });
        }

        const result = await godaddy.adjustInventory(
          {
            storeId: input.storeId,
            skuId: input.skuId,
            locationId: input.locationId,
            delta: input.quantity,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to adjust inventory',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            adjustments: result.data.adjustInventory,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'stock') {
        if (!input.skuId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'SKU ID is required for stock action',
          });
        }
        if (!input.locationId) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Location ID is required for stock action',
          });
        }
        if (input.quantity === undefined || input.quantity < 0) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'Quantity must be a non-negative number for stock action',
          });
        }

        const result = await godaddy.stockInventory(
          {
            storeId: input.storeId,
            skuId: input.skuId,
            locationId: input.locationId,
            quantity: input.quantity,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to stock inventory',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            adjustments: result.data.stockInventory,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
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
          }
        );
      }
      throw err;
    }
  }
);

export const commerceSkuGroupMedia = createTool(
  'Manage media objects (images) for a SKU Group (product) in GoDaddy Commerce store. Supports add and remove operations via "action" parameter. Use the mediaSearch tool first to find images, then use this tool to attach them to products.',
  z.object({
    action: z.enum(['add', 'remove']).describe('Action to perform: "add" to add new images, "remove" to remove existing images'),
    storeId: z.string().describe('The store ID'),
    skuGroupId: z.string().describe('The ID of the SKU Group (product) to add/remove media from'),
    mediaObjects: z
      .array(
        z.object({
          type: z
            .enum(['IMAGE', 'PHOTO', 'VIDEO'])
            .default('IMAGE')
            .describe('The type of media. Use "IMAGE" for most images.'),
          url: z.string().url().describe('The URL of the media to add'),
          label: z.string().optional().describe('Optional display label for the media'),
          name: z.string().optional().describe('Optional unique name identifier for the media'),
          position: z.number().int().optional().describe('Optional position/order of the media (lower numbers appear first)'),
        })
      )
      .optional()
      .describe('Array of media objects to add (required for "add" action). Get URLs from mediaSearch tool.'),
    mediaObjectIds: z
      .array(z.string())
      .optional()
      .describe('Array of media object IDs to remove (required for "remove" action). Get IDs from skuGroup read action.'),
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

      if (input.action === 'add') {
        if (!input.mediaObjects || input.mediaObjects.length === 0) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'mediaObjects array is required for add action',
            hint: 'Use the mediaSearch tool to find image URLs first',
          });
        }

        const result = await godaddy.addMediaObjectsToSkuGroup(
          {
            storeId: input.storeId,
            skuGroupId: input.skuGroupId,
            mediaObjects: input.mediaObjects.map((m) => ({
              type: m.type || 'IMAGE',
              url: m.url,
              ...(m.label && { label: m.label }),
              ...(m.name && { name: m.name }),
              ...(m.position !== undefined && { position: m.position }),
            })),
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to add media objects to SKU Group',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            skuGroupId: input.skuGroupId,
            skuGroup: result.data.addMediaObjectsToSkuGroup,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
          }
        );
      }

      if (input.action === 'remove') {
        if (!input.mediaObjectIds || input.mediaObjectIds.length === 0) {
          return fail({
            code: ErrorCodes.INVALID_INPUT,
            message: 'mediaObjectIds array is required for remove action',
            hint: 'Use the skuGroup tool with action "read" to get existing media object IDs',
          });
        }

        const result = await godaddy.removeMediaObjectsFromSkuGroup(
          {
            storeId: input.storeId,
            skuGroupId: input.skuGroupId,
            mediaObjectIds: input.mediaObjectIds,
          },
          accessToken
        );

        if (!result.success) {
          return fail({
            code: ErrorCodes.OPERATION_FAILED,
            message: result.error || 'Failed to remove media objects from SKU Group',
            retryable: true,
          });
        }

        return ok(
          {
            storeId: input.storeId,
            skuGroupId: input.skuGroupId,
            skuGroup: result.data.removeMediaObjectsFromSkuGroup,
            manageUrl: godaddy.getCatalogManagementUrl(input.storeId),
          },
          {
            tookMs: Date.now() - startTime,
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
          }
        );
      }
      throw err;
    }
  }
);

