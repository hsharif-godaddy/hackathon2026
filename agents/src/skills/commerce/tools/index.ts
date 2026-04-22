/**
 * Commerce Skill Tools
 *
 * Provides deterministic workflows for GoDaddy Commerce store setup,
 * catalog fetching, storefront installation, product management, and orders.
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { GoDaddyCommerce, type GetSkuGroupsResponse } from '../../../lib/godaddy-commerce.js';
import { Logger } from '../../../logging/index.js';
import { getNomadAllocConfig } from '../../../utils/nomad-config.js';
import { appRepository } from '../../../database/repositories/index.js';
import { withCommerceAuth, type CommerceAuthResult } from './auth.js';
import type { SkillToolDefinition, SkillHooks } from '@airo/ai-skills';
import { ensureViteResolveDedupe } from '../../../services/vite-dedupe.js';

const logger = Logger.create({ component: 'commerce.skill' });

export const hooks: SkillHooks = {
  onInstall: async ({ appPath }) => {
    if (appPath) {
      ensureViteResolveDedupe(appPath);
    }
  },
};
const godaddy = new GoDaddyCommerce();

type CommerceManageLinks = {
  homeUrl: string;
  ordersUrl: string;
  catalogUrl: string;
};

function buildManageLinks(storeId: string): CommerceManageLinks {
  return {
    homeUrl: godaddy.getStoreManagementUrl(storeId),
    ordersUrl: godaddy.getOrdersManagementUrl(),
    catalogUrl: godaddy.getCatalogManagementUrl(),
  };
}

function buildDashboardLinksMarkdown(manageLinks: CommerceManageLinks): string {
  return [
    'Manage your store in Commerce Home:',
    `- Home: ${manageLinks.homeUrl}`,
    `- Orders: ${manageLinks.ordersUrl}`,
    `- Catalog: ${manageLinks.catalogUrl}`,
  ].join('\n');
}

function withManageLinks(
  authResult: CommerceAuthResult<any>,
  storeId?: string,
): CommerceAuthResult<any> {
  if (!storeId) {
    return authResult;
  }

  if (!('success' in authResult) || authResult.success !== true) {
    return authResult;
  }

  const manageLinks = buildManageLinks(storeId);
  const existingManageUrl =
    typeof (authResult.data as Record<string, unknown> | undefined)?.manageUrl === 'string'
      ? ((authResult.data as Record<string, unknown>).manageUrl as string)
      : manageLinks.homeUrl;

  return {
    success: true,
    data: {
      ...(authResult.data || {}),
      manageLinks,
      manageUrl: existingManageUrl,
      dashboardLinks: buildDashboardLinksMarkdown(manageLinks),
    },
  };
}

/** Convert a human-readable name to a lowercase slug (API requires ^[a-z0-9_-]+$). */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

function ensureUniqueSlug(base: string, used: Set<string>): string {
  const normalizedBase = slugify(base || 'item') || 'item';
  let candidate = normalizedBase;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${normalizedBase}-${i}`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

type CommerceAttributeInput = {
  label: string;
  name?: string;
  description?: string;
  position?: number;
  values?: Array<{
    label: string;
    name?: string;
    position?: number;
  }>;
};

type GeneratedSkuAssociation = {
  skuName: string;
  attributePairs: Array<{ attributeName: string; valueName: string }>;
};

function normalizeAttributes(attributes: CommerceAttributeInput[] | undefined): CommerceAttributeInput[] | undefined {
  if (!attributes || attributes.length === 0) {
    return attributes;
  }

  const usedAttributeNames = new Set<string>();

  return attributes.map((attribute) => {
    const attributeName = ensureUniqueSlug(attribute.name || attribute.label, usedAttributeNames);
    const usedValueNames = new Set<string>();

    return {
      ...attribute,
      name: attributeName,
      values: attribute.values?.map((value) => ({
        ...value,
        name: ensureUniqueSlug(value.name || value.label, usedValueNames),
      })),
    };
  });
}

function generateDefaultSku(args: {
  label: string;
  name?: string;
  defaultSku?: any;
}) {
  return {
    label: args.defaultSku?.label ?? args.label,
    name: args.defaultSku?.name ?? `${slugify(args.name || args.label)}-default`,
    status: args.defaultSku?.status ?? 'ACTIVE',
    code: args.defaultSku?.code,
    description: args.defaultSku?.description,
    prices: args.defaultSku?.prices,
    weight: args.defaultSku?.weight,
    unitOfWeight: args.defaultSku?.unitOfWeight,
  };
}

function generateSkusFromAttributes(args: {
  label: string;
  name?: string;
  attributes: CommerceAttributeInput[];
  skuTemplate?: any;
}): { skus: any[]; associations: GeneratedSkuAssociation[] } {
  const attributesWithValues = args.attributes.filter((attribute) => (attribute.values?.length || 0) > 0);

  const combinations: Array<
    Array<{
      attributeName: string;
      valueName: string;
      valueLabel: string;
    }>
  > = [];

  const walk = (
    index: number,
    current: Array<{
      attributeName: string;
      valueName: string;
      valueLabel: string;
    }>,
  ) => {
    if (index >= attributesWithValues.length) {
      combinations.push(current);
      return;
    }

    const attribute = attributesWithValues[index];
    if (!attribute) return;

    for (const value of attribute.values || []) {
      walk(index + 1, [
        ...current,
        {
          attributeName: attribute.name || slugify(attribute.label),
          valueName: value.name || slugify(value.label),
          valueLabel: value.label,
        },
      ]);
    }
  };

  walk(0, []);

  const usedSkuNames = new Set<string>();
  const skus = combinations.map((combo, index) => {
    const valueLabels = combo.map((entry) => entry.valueLabel).join(' / ');
    const generatedName = `${args.name || args.label}-${combo.map((entry) => entry.valueName).join('-')}`;

    return {
      label: args.skuTemplate?.label ?? `${args.label} - ${valueLabels}`,
      name: ensureUniqueSlug(
        args.skuTemplate?.name ? `${args.skuTemplate.name}-${index + 1}` : generatedName,
        usedSkuNames,
      ),
      status: args.skuTemplate?.status ?? 'ACTIVE',
      code: args.skuTemplate?.code,
      description: args.skuTemplate?.description,
      prices: args.skuTemplate?.prices,
      weight: args.skuTemplate?.weight,
      unitOfWeight: args.skuTemplate?.unitOfWeight,
    };
  });

  const associations: GeneratedSkuAssociation[] = skus.map((sku, index) => {
    const combo = combinations[index] || [];
    return {
      skuName: sku.name,
      attributePairs: combo.map((entry) => ({
        attributeName: entry.attributeName,
        valueName: entry.valueName,
      })),
    };
  });

  return { skus, associations };
}

// ============================================================================
// setup_store
// ============================================================================

export const setupStoreTool: SkillToolDefinition = {
  name: 'setup_store',
  description:
    'Set up a GoDaddy Commerce store. Checks for an existing store, creates one if needed, enables Catalog V2 and GoDaddy Payments. Returns storeId, channelId, and management URL.',
  parameters: z.object({
    firstName: z.string().optional().describe('First name of the store owner (required if no existing store)'),
    lastName: z.string().optional().describe('Last name of the store owner (required if no existing store)'),
    email: z.string().optional().describe('Email address of the store owner (required if no existing store)'),
    storeName: z.string().optional().describe('Optional store name'),
  }),
  execute: async (
    input: { firstName?: string; lastName?: string; email?: string; storeName?: string },
    context?: any,
  ) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken, customerId) => {
      // Check for existing store
      const summary = (await godaddy.getStoreSummary({ customerId }, accessToken)) as {
        storeId?: string;
        channelId?: string;
      };

      if (summary.storeId) {
        logger.info('commerce.skill.setup_store.existing', {
          appId,
          storeId: summary.storeId,
        });

        // Enable GoDaddy Payments for existing stores (idempotent, non-fatal)
        try {
          await godaddy.enableGoDaddyPaymentsApplication({ storeId: summary.storeId }, accessToken);
        } catch (err) {
          logger.warn('commerce.skill.setup_store.existing_payments.failed', {
            appId,
            storeId: summary.storeId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // Ensure the store has a location so the agent can stock inventory
        let locationId: string | undefined;
        try {
          const locResponse = await godaddy.getLocations({ storeId: summary.storeId }, accessToken);
          if (locResponse.success) {
            const firstLocation = locResponse.data.locations.edges[0]?.node;
            if (firstLocation) {
              locationId = firstLocation.id;
            }
          }
          // No locations — create a default one, same as new store path
          if (!locationId) {
            const createResponse = await godaddy.createLocation(
              {
                storeId: summary.storeId,
                location: {
                  label: 'Default',
                  name: 'default',
                  status: 'ACTIVE',
                  address: { addressLine1: 'Default', countryCode: 'US' },
                },
              },
              accessToken,
            );
            if (createResponse.success) {
              locationId = createResponse.data.createLocation.id;
            }
          }
        } catch (err) {
          logger.warn('commerce.skill.setup_store.existing_location.failed', {
            appId,
            storeId: summary.storeId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return {
          storeId: summary.storeId,
          channelId: summary.channelId,
          manageUrl: godaddy.getStoreManagementUrl(summary.storeId),
          created: false,
          ...(locationId && { locationId }),
        };
      }

      // No existing store — tell the AI what info is needed to create one
      if (!input.firstName || !input.lastName || !input.email) {
        const missing = [
          ...(!input.firstName ? ['firstName'] : []),
          ...(!input.lastName ? ['lastName'] : []),
          ...(!input.email ? ['email'] : []),
        ];
        return {
          needsInfo: true,
          message: 'firstName, lastName, and email are required to create a new store',
          missingFields: missing,
        };
      }

      // Create new store
      const onboardResult = await godaddy.onboardApplication(
        {
          appId,
          customerId,
          storeName: input.storeName,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
        },
        accessToken,
      );

      const storeId = onboardResult.metadata.storeId;
      const channelId = onboardResult.metadata.channelId;

      if (!storeId) {
        throw new Error('Store onboarding succeeded but no storeId was returned');
      }

      const errors: string[] = [];

      // Enable Catalog V2 (non-fatal) and GoDaddy Payments (required) concurrently
      const [catalogResult, paymentsResult] = await Promise.allSettled([
        godaddy.enableCatalogV2({ storeId }, accessToken),
        godaddy.enableGoDaddyPaymentsApplication({ storeId }, accessToken),
      ]);

      if (catalogResult.status === 'rejected') {
        logger.error('commerce.skill.setup_store.catalog_v2.failed', {
          appId,
          storeId,
          error: catalogResult.reason instanceof Error ? catalogResult.reason.message : String(catalogResult.reason),
        });
        errors.push('catalog_v2_enablement_failed');
      }

      if (paymentsResult.status === 'rejected') {
        throw paymentsResult.reason;
      }

      // Create default location so products can have inventory (non-fatal)
      let locationId: string | undefined;
      try {
        const locationResponse = await godaddy.createLocation(
          {
            storeId,
            location: {
              label: 'Default',
              name: 'default',
              status: 'ACTIVE',
              address: { addressLine1: 'Default', countryCode: 'US' },
            },
          },
          accessToken,
        );
        if (locationResponse.success) {
          locationId = locationResponse.data.createLocation.id;
        } else {
          errors.push('default_location_failed');
        }
      } catch (err) {
        logger.error('commerce.skill.setup_store.default_location.failed', {
          appId,
          storeId,
          error: err instanceof Error ? err.message : String(err),
        });
        errors.push('default_location_failed');
      }

      logger.info('commerce.skill.setup_store.created', { appId, storeId });

      return {
        storeId,
        channelId,
        manageUrl: godaddy.getStoreManagementUrl(storeId),
        created: true,
        ...(locationId && { locationId }),
        ...(errors.length > 0 && { errors }),
      };
    });

    const resolvedStoreId =
      'success' in authResult && typeof (authResult as any).data?.storeId === 'string'
        ? (authResult as any).data.storeId
        : undefined;
    return withManageLinks(authResult, resolvedStoreId);
  },
};

// ============================================================================
// fetch_catalog
// ============================================================================

export const fetchCatalogTool: SkillToolDefinition = {
  name: 'fetch_catalog',
  description:
    'Fetch products from a GoDaddy Commerce store catalog. Returns one page of products with pagination metadata. Use the `after` cursor to fetch subsequent pages.',
  parameters: z.object({
    storeId: z.string().describe('The store ID to fetch products from'),
    query: z.string().optional().describe('Optional search filter for product labels'),
    after: z.string().optional().describe('Pagination cursor from a previous response to fetch the next page'),
    first: z.coerce.number().int().min(1).max(100).optional().describe('Number of products per page (default 50, max 100)'),
  }),
  execute: async (
    input: { storeId: string; query?: string; after?: string; first?: number },
    context?: any,
  ) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      const response: GetSkuGroupsResponse = await godaddy.getSkuGroups(
        {
          storeId: input.storeId,
          first: input.first ?? 50,
          after: input.after,
          query: input.query,
        },
        accessToken,
      );

      if (!response.success) {
        throw new Error(`Failed to fetch catalog: ${response.error}`);
      }

      const { edges, pageInfo, totalCount } = response.data.skuGroups;

      const products = edges.map((edge: any) => {
        const node = edge.node;
        return {
          id: node.id,
          label: node.label,
          description: node.description,
          type: node.type,
          status: node.status,
          skus: node.skus?.edges?.map((e: any) => ({
            id: e.node.id,
            label: e.node.label,
            code: e.node.code,
            name: e.node.name,
            status: e.node.status,
            prices: e.node.prices?.edges?.map((p: any) => ({
              priceId: p.node.id,
              currencyCode: p.node.value?.currencyCode,
              value: p.node.value?.value,
            })) ?? [],
          })) ?? [],
        };
      });

      logger.info('commerce.skill.fetch_catalog.complete', {
        appId,
        storeId: input.storeId,
        productCount: products.length,
        totalCount,
      });

      return {
        products,
        totalCount,
        hasMore: pageInfo.hasNextPage,
        ...(pageInfo.endCursor && { endCursor: pageInfo.endCursor }),
      };
    });

    return withManageLinks(authResult, input.storeId);
  },
};

// ============================================================================
// install_storefront
// ============================================================================

/**
 * Get the GoDaddy OAuth client ID from alloc config or environment.
 */
function getClientId(): string | undefined {
  const allocConfig = getNomadAllocConfig();
  return allocConfig?.GODADDY_OAUTH_CLIENT_ID?.VALUE || process.env.GODADDY_OAUTH_CLIENT_ID;
}

/**
 * Extract hostname from GODADDY_API_BASE_URL (strip protocol).
 */
function getApiHost(): string | undefined {
  const baseUrl = process.env.GODADDY_API_BASE_URL;
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '');
  }
}

/**
 * Normalize API base URL for server-side Commerce routes.
 */
function getApiBaseUrl(): string | undefined {
  const baseUrl = process.env.GODADDY_API_BASE_URL;
  if (baseUrl) {
    if (/^https?:\/\//.test(baseUrl)) return baseUrl;
    return `https://${baseUrl}`;
  }

  const hostOnly = process.env.VITE_GODADDY_API_HOST;
  if (hostOnly) {
    return /^https?:\/\//.test(hostOnly) ? hostOnly : `https://${hostOnly}`;
  }

  const apiHost = getApiHost();
  if (!apiHost) return undefined;
  return `https://${apiHost}`;
}

export const installStorefrontTool: SkillToolDefinition = {
  name: 'install_storefront',
  description:
    'Configure environment variables for GoDaddy Commerce storefront. Writes VITE_GODADDY_CLIENT_ID, VITE_GODADDY_API_HOST, GODADDY_API_BASE_URL, VITE_GODADDY_STORE_ID, and VITE_GODADDY_CHANNEL_ID to the app .env file. Templates are installed by the skill loader.',
  parameters: z.object({
    storeId: z.string().describe('The store ID to configure'),
    channelId: z.string().describe('The channel ID to configure'),
  }),
  execute: async (
    input: { storeId: string; channelId: string },
    context?: any,
  ) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const app = await appRepository.findById(appId);
    if (!app?.path) {
      return { error: `Could not resolve app path for appId: ${appId}` };
    }

    const clientId = getClientId();
    const apiHost = getApiHost();
    const apiBaseUrl = getApiBaseUrl();
    const envVarsWritten: string[] = [];

    const envPath = join(app.path, '.env');

    // Read existing .env content (or start empty) and upsert keys
    let envContent: string;
    try {
      envContent = await readFile(envPath, 'utf-8');
    } catch {
      envContent = '';
    }

    function upsertEnvVar(content: string, key: string, value: string): string {
      const lines = content.split('\n');
      const prefix = `${key}=`;
      const idx = lines.findIndex(line => line.startsWith(prefix));
      if (idx !== -1) {
        lines[idx] = `${key}=${value}`;
        return lines.join('\n');
      }
      return content + (content.endsWith('\n') || content === '' ? '' : '\n') + `${key}=${value}\n`;
    }

    if (clientId) {
      envContent = upsertEnvVar(envContent, 'VITE_GODADDY_CLIENT_ID', clientId);
      envVarsWritten.push('VITE_GODADDY_CLIENT_ID');
    }

    if (apiHost) {
      envContent = upsertEnvVar(envContent, 'VITE_GODADDY_API_HOST', apiHost);
      envVarsWritten.push('VITE_GODADDY_API_HOST');
    }

    if (apiBaseUrl) {
      envContent = upsertEnvVar(envContent, 'GODADDY_API_BASE_URL', apiBaseUrl);
      envVarsWritten.push('GODADDY_API_BASE_URL');
    }

    envContent = upsertEnvVar(envContent, 'VITE_GODADDY_STORE_ID', input.storeId);
    envVarsWritten.push('VITE_GODADDY_STORE_ID');

    envContent = upsertEnvVar(envContent, 'VITE_GODADDY_CHANNEL_ID', input.channelId);
    envVarsWritten.push('VITE_GODADDY_CHANNEL_ID');

    await writeFile(envPath, envContent);

    if (!clientId || !apiHost || !apiBaseUrl) {
      logger.warn('commerce.skill.install_storefront.missing_optional_vars', {
        appId,
        storeId: input.storeId,
        hasClientId: !!clientId,
        hasApiHost: !!apiHost,
        hasApiBaseUrl: !!apiBaseUrl,
      });
    }

    logger.info('commerce.skill.install_storefront.complete', {
      appId,
      storeId: input.storeId,
      envVarsWritten,
    });

    const manageLinks = buildManageLinks(input.storeId);

    return {
      storeId: input.storeId,
      channelId: input.channelId,
      envVarsWritten,
      manageUrl: godaddy.getStoreManagementUrl(input.storeId),
      manageLinks,
      dashboardLinks: buildDashboardLinksMarkdown(manageLinks),
    };
  },
};

// ============================================================================
// manage_products — product CRUD + SKU updates
// ============================================================================

export const manageProductsTool: SkillToolDefinition = {
  name: 'manage_products',
  description:
    'Create, update, or delete products and SKUs in a GoDaddy Commerce store.',
  parameters: z.object({
    action: z.enum(['createProduct', 'updateProduct', 'deleteProduct', 'updateSku']).describe('The action to perform'),
    storeId: z.string().describe('The store ID'),
    skuGroupId: z.string().optional().describe('SKU group (product) ID — required for updateProduct, deleteProduct'),
    skuId: z.string().optional().describe('SKU ID — required for updateSku'),
    label: z.string().optional().describe('Product or SKU label'),
    description: z.string().optional().describe('Product description'),
    type: z.enum(['PHYSICAL', 'DIGITAL']).optional().describe('Product type — required for createProduct'),
    status: z.enum(['ACTIVE', 'DRAFT']).optional().describe('Product or SKU status'),
    skuLabel: z.string().optional().describe('SKU label for updateSku'),
    skuName: z.string().optional().describe('SKU name (auto-slugified) for updateSku'),
    skuCode: z.string().optional().describe('SKU code for updateSku'),
    skuGenerationMode: z
      .enum(['manual', 'singleDefault', 'fromAttributes'])
      .optional()
      .describe('SKU creation mode for createProduct. manual uses skus[] directly. singleDefault auto-creates one default SKU. fromAttributes auto-generates SKUs from attributes[].values[] and associates attribute values to each SKU.'),
    defaultSku: z
      .object({
        label: z.string().optional(),
        name: z.string().optional(),
        status: z.enum(['ACTIVE', 'DRAFT']).optional(),
        code: z.string().optional(),
        description: z.string().optional(),
        prices: z.array(z.any()).optional(),
        weight: z.number().optional(),
        unitOfWeight: z.enum(['KG', 'GR', 'LB', 'OZ']).optional(),
      })
      .optional()
      .describe('Template used when skuGenerationMode is singleDefault'),
    skuTemplate: z
      .object({
        label: z.string().optional(),
        name: z.string().optional(),
        status: z.enum(['ACTIVE', 'DRAFT']).optional(),
        code: z.string().optional(),
        description: z.string().optional(),
        prices: z.array(z.any()).optional(),
        weight: z.number().optional(),
        unitOfWeight: z.enum(['KG', 'GR', 'LB', 'OZ']).optional(),
      })
      .optional()
      .describe('Template applied to generated SKUs when skuGenerationMode is fromAttributes'),
    attributes: z
      .array(
        z.object({
          label: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          position: z.number().int().optional(),
          values: z
            .array(
              z.object({
                label: z.string(),
                name: z.string().optional(),
                position: z.number().int().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional()
      .describe('Optional product attributes and values for createProduct'),
    skus: z.array(z.record(z.string(), z.unknown())).optional().describe('Array of SKU objects for createProduct (manual mode)'),
  }),
  execute: async (input: any, context?: any) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      switch (input.action) {
        case 'createProduct': {
          if (!input.label || !input.type) {
            throw new Error('label and type are required for createProduct');
          }

          const skuGenerationMode = input.skuGenerationMode || 'manual';
          const normalizedAttributes = normalizeAttributes(input.attributes as CommerceAttributeInput[] | undefined);

          const manualSkus = input.skus?.map((sku: any) => ({
            ...sku,
            ...(sku.name && { name: slugify(sku.name) }),
            status: sku.status ?? 'ACTIVE',
          }));

          if (skuGenerationMode === 'fromAttributes' && manualSkus && manualSkus.length > 0) {
            throw new Error('skus cannot be provided when skuGenerationMode is "fromAttributes"');
          }

          if (skuGenerationMode === 'singleDefault' && manualSkus && manualSkus.length > 0) {
            throw new Error('skus cannot be provided when skuGenerationMode is "singleDefault"');
          }

          let skus = manualSkus;
          let generatedAssociations: GeneratedSkuAssociation[] = [];

          if ((!skus || skus.length === 0) && skuGenerationMode === 'singleDefault') {
            skus = [
              generateDefaultSku({
                label: input.label,
                name: input.name,
                defaultSku: input.defaultSku,
              }),
            ];
          }

          if ((!skus || skus.length === 0) && skuGenerationMode === 'fromAttributes') {
            if (!normalizedAttributes || normalizedAttributes.length === 0) {
              throw new Error('attributes with values are required when skuGenerationMode is "fromAttributes"');
            }

            const missingValues = normalizedAttributes.filter((attribute) => !attribute.values || attribute.values.length === 0);
            if (missingValues.length > 0) {
              throw new Error('Each attribute must include at least one value when skuGenerationMode is "fromAttributes"');
            }

            const generated = generateSkusFromAttributes({
              label: input.label,
              name: input.name,
              attributes: normalizedAttributes,
              skuTemplate: input.skuTemplate,
            });

            skus = generated.skus;
            generatedAssociations = generated.associations;
          }

          if (!skus || skus.length === 0) {
            skus = [
              generateDefaultSku({
                label: input.label,
                name: input.name,
                defaultSku: input.defaultSku,
              }),
            ];
          }

          const product: any = {
            label: input.label,
            type: input.type,
            status: input.status ?? 'ACTIVE',
          };
          if (input.description) product.description = input.description;
          if (normalizedAttributes) product.attributes = normalizedAttributes;
          if (skus) product.skus = skus;

          const response = await godaddy.createSkuGroup(
            { storeId: input.storeId, product },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to create product: ${response.error}`);
          }

          let skuGroup = response.data.createSkuGroup;
          const skuAssociationErrors: string[] = [];
          let skuAssociationFailedCount = 0;

          if (skuGenerationMode === 'fromAttributes' && generatedAssociations.length > 0) {
            const skuGroupRead = await godaddy.getSkuGroup(
              { storeId: input.storeId, skuGroupId: skuGroup.id },
              accessToken,
            );

            if (!skuGroupRead.success || !skuGroupRead.data?.skuGroup) {
              skuAssociationErrors.push(skuGroupRead.error || 'Failed to fetch SKU Group for SKU attribute association');
              // If we cannot fetch the created SKU group, all associations are considered failed.
              skuAssociationFailedCount = generatedAssociations.length;
            } else {
              skuGroup = skuGroupRead.data.skuGroup;

              const skuIdByName = new Map(
                (skuGroup.skus?.edges || []).map((edge: any) => [edge.node.name, edge.node.id]),
              );

              const attributeValueIdByName = new Map<string, string>();
              for (const attributeEdge of skuGroup.attributes?.edges || []) {
                const attributeName = attributeEdge.node.name;
                for (const valueEdge of attributeEdge.node.values?.edges || []) {
                  attributeValueIdByName.set(
                    `${attributeName}::${valueEdge.node.name}`,
                    valueEdge.node.id,
                  );
                }
              }

              for (const association of generatedAssociations) {
                const errorsBefore = skuAssociationErrors.length;

                const skuId = skuIdByName.get(association.skuName);
                if (!skuId) {
                  skuAssociationErrors.push(`Could not find generated SKU with name "${association.skuName}"`);
                  skuAssociationFailedCount += 1;
                  continue;
                }

                const attributeValueIds: string[] = [];
                for (const pair of association.attributePairs) {
                  const attributeValueId = attributeValueIdByName.get(`${pair.attributeName}::${pair.valueName}`);
                  if (!attributeValueId) {
                    skuAssociationErrors.push(
                      `Could not find attribute value for pair "${pair.attributeName}:${pair.valueName}"`,
                    );
                    continue;
                  }
                  attributeValueIds.push(attributeValueId);
                }

                if (attributeValueIds.length !== association.attributePairs.length) {
                  if (skuAssociationErrors.length > errorsBefore) {
                    skuAssociationFailedCount += 1;
                  }
                  continue;
                }

                const associationResult = await godaddy.addAttributeValuesToSku(
                  { storeId: input.storeId, skuId, attributeValueIds },
                  accessToken,
                );
                if (!associationResult.success) {
                  skuAssociationErrors.push(
                    `Failed to associate attribute values for SKU "${association.skuName}": ${associationResult.error}`,
                  );
                }

                if (skuAssociationErrors.length > errorsBefore) {
                  skuAssociationFailedCount += 1;
                }
              }
            }
          }

          if (skuAssociationErrors.length > 0) {
            logger.warn('commerce.skill.manage_products.create_product.association.partial_failure', {
              appId,
              storeId: input.storeId,
              skuGroupId: skuGroup.id,
              errors: skuAssociationErrors,
            });
          }

          return {
            skuGroup,
            skuGenerationMode,
            generatedSkuCount: skus.length,
            skuAssociation: skuGenerationMode === 'fromAttributes'
              ? {
                  attempted: generatedAssociations.length,
                  failed: skuAssociationFailedCount,
                  errors: skuAssociationErrors,
                }
              : undefined,
            manageUrl: godaddy.getCatalogManagementUrl(),
          };
        }

        case 'updateProduct': {
          if (!input.skuGroupId) {
            throw new Error('skuGroupId is required for updateProduct');
          }
          const product: any = {};
          if (input.label) product.label = input.label;
          if (input.description) product.description = input.description;
          if (input.status) product.status = input.status;
          const response = await godaddy.updateSkuGroup(
            { storeId: input.storeId, skuGroupId: input.skuGroupId, product },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to update product: ${response.error}`);
          }
          return {
            skuGroup: response.data.updateSkuGroup,
            manageUrl: godaddy.getCatalogManagementUrl(),
          };
        }

        case 'deleteProduct': {
          if (!input.skuGroupId) {
            throw new Error('skuGroupId is required for deleteProduct');
          }
          const response = await godaddy.deleteSkuGroup(
            { storeId: input.storeId, skuGroupId: input.skuGroupId },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to delete product: ${response.error}`);
          }
          const deletedId = response.data?.deleteSkuGroupById?.id;
          if (!deletedId) {
            throw new Error('Product not found or already deleted');
          }
          return { deleted: true, id: deletedId };
        }

        case 'updateSku': {
          if (!input.skuId) {
            throw new Error('skuId is required for updateSku');
          }
          const sku: any = {};
          if (input.skuLabel) sku.label = input.skuLabel;
          if (input.skuName) sku.name = slugify(input.skuName);
          if (input.skuCode) sku.code = input.skuCode;
          if (input.status) sku.status = input.status;
          const response = await godaddy.updateSku(
            { storeId: input.storeId, skuId: input.skuId, product: sku },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to update SKU: ${response.error}`);
          }
          return { sku: response.data.updateSku };
        }

        default:
          throw new Error(`Unknown action: ${input.action}`);
      }
    });

    return withManageLinks(authResult, input.storeId);
  },
};

// ============================================================================
// manage_inventory — locations and stock
// ============================================================================

export const manageInventoryTool: SkillToolDefinition = {
  name: 'manage_inventory',
  description:
    'Manage inventory locations and stock levels in a GoDaddy Commerce store.',
  parameters: z.object({
    action: z.enum(['getLocations', 'createLocation', 'adjustInventory', 'stockInventory']).describe('The action to perform'),
    storeId: z.string().describe('The store ID'),
    skuId: z.string().optional().describe('SKU ID — required for adjustInventory, stockInventory'),
    locationId: z.string().optional().describe('Location ID — required for adjustInventory, stockInventory'),
    locationLabel: z.string().optional().describe('Location label — required for createLocation'),
    locationName: z.string().optional().describe('Location name slug (auto-slugified)'),
    addressLine1: z.string().optional().describe('Street address — required for createLocation'),
    addressLine2: z.string().optional().describe('Address line 2'),
    adminArea1: z.string().optional().describe('State/province'),
    adminArea2: z.string().optional().describe('City'),
    postalCode: z.string().optional().describe('Postal code'),
    countryCode: z.string().optional().describe('Country code — required for createLocation'),
    delta: z.coerce.number().int().optional().describe('Inventory adjustment delta (positive to add, negative to remove) — required for adjustInventory'),
    quantity: z.coerce.number().int().optional().describe('Absolute inventory quantity to set — required for stockInventory'),
  }),
  execute: async (input: any, context?: any) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      switch (input.action) {
        case 'getLocations': {
          const response = await godaddy.getLocations(
            { storeId: input.storeId },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to get locations: ${response.error}`);
          }
          const locData = response.data.locations;
          return {
            locations: locData.edges.map((e: any) => e.node),
            totalCount: locData.totalCount,
          };
        }

        case 'createLocation': {
          if (!input.locationLabel) {
            throw new Error('locationLabel is required for createLocation');
          }
          if (!input.addressLine1 || !input.countryCode) {
            throw new Error('addressLine1 and countryCode are required for createLocation');
          }
          const location: any = {
            label: input.locationLabel,
            status: 'ACTIVE',
            address: {
              addressLine1: input.addressLine1,
              countryCode: input.countryCode,
            },
          };
          if (input.locationName) location.name = slugify(input.locationName);
          if (input.addressLine2) location.address.addressLine2 = input.addressLine2;
          if (input.adminArea1) location.address.adminArea1 = input.adminArea1;
          if (input.adminArea2) location.address.adminArea2 = input.adminArea2;
          if (input.postalCode) location.address.postalCode = input.postalCode;
          const response = await godaddy.createLocation(
            { storeId: input.storeId, location },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to create location: ${response.error}`);
          }
          return { location: response.data.createLocation };
        }

        case 'adjustInventory': {
          if (!input.skuId || !input.locationId || input.delta === undefined) {
            throw new Error('skuId, locationId, and delta are required for adjustInventory');
          }
          const response = await godaddy.adjustInventory(
            { storeId: input.storeId, skuId: input.skuId, locationId: input.locationId, delta: input.delta },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to adjust inventory: ${response.error}`);
          }
          return { adjustments: response.data.adjustInventory };
        }

        case 'stockInventory': {
          if (!input.skuId || !input.locationId || input.quantity === undefined) {
            throw new Error('skuId, locationId, and quantity are required for stockInventory');
          }
          const response = await godaddy.stockInventory(
            { storeId: input.storeId, skuId: input.skuId, locationId: input.locationId, quantity: input.quantity },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to stock inventory: ${response.error}`);
          }
          return { stock: response.data.stockInventory };
        }

        default:
          throw new Error(`Unknown action: ${input.action}`);
      }
    });

    return withManageLinks(authResult, input.storeId);
  },
};

// ============================================================================
// manage_pricing — price updates
// ============================================================================

export const managePricingTool: SkillToolDefinition = {
  name: 'manage_pricing',
  description:
    'Create or update a SKU price in a GoDaddy Commerce store. All price values must be integers in minor currency units (e.g. 550 for $5.50, 1000 for $10.00). Provide priceId from fetch_catalog to update an existing price, or omit priceId / set priceId to "new" to create one.',
  parameters: z.object({
    storeId: z.string().describe('The store ID'),
    skuId: z.string().describe('SKU ID whose price to create/update'),
    priceId: z.string().optional().describe('Existing price ID to update (from fetch_catalog). Omit or set to "new" to create a price for the SKU.'),
    currencyCode: z.string().describe('Currency code (e.g. USD, AUD, JPY)'),
    value: z.coerce.number().int().describe('Price in minor currency units (e.g. 550 for $5.50)'),
    compareAtValue: z.coerce.number().int().optional().describe('Compare-at price in minor currency units (for showing discounts)'),
  }),
  execute: async (input: any, context?: any) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      if (!input.skuId) {
        throw new Error('skuId is required for manage_pricing');
      }

      const priceInput: any = { value: { currencyCode: input.currencyCode, value: input.value } };
      if (input.compareAtValue !== undefined) {
        priceInput.compareAtValue = { currencyCode: input.currencyCode, value: input.compareAtValue };
      }

      const shouldCreate = !input.priceId || String(input.priceId).toLowerCase() === 'new';

      if (shouldCreate) {
        const response = await godaddy.createSkuPrice(
          { storeId: input.storeId, skuId: input.skuId, input: priceInput },
          accessToken,
        );

        if (!response.success) {
          throw new Error(`Failed to create price: ${response.error}`);
        }

        return { price: response.data.createSkuPrice, operation: 'create' };
      }

      const response = await godaddy.updateSkuPrice(
        { storeId: input.storeId, priceId: input.priceId, input: priceInput },
        accessToken,
      );
      if (!response.success) {
        throw new Error(`Failed to update price: ${response.error}`);
      }
      return { price: response.data.updateSkuPrice, operation: 'update' };
    });

    return withManageLinks(authResult, input.storeId);
  },
};

// ============================================================================
// manage_media — add/remove product media
// ============================================================================

/** Normalize PHOTO → IMAGE since LLMs pick PHOTO more naturally. */
function normalizeMediaType(type: string | undefined): string {
  if (type === 'PHOTO') return 'IMAGE';
  return type || 'IMAGE';
}

/** Coerce mediaObjects from a JSON string if the LLM sends it stringified. */
function coerceMediaObjects(val: unknown): any[] | undefined {
  let arr: any[] | undefined;
  if (Array.isArray(val)) arr = val;
  else if (typeof val === 'string') {
    try { arr = JSON.parse(val); } catch { return undefined; }
  }
  return arr?.map(obj => ({ ...obj, type: normalizeMediaType(obj.type) }));
}

/** Coerce mediaObjectIds from a JSON string if the LLM sends it stringified. */
function coerceStringArray(val: unknown): string[] | undefined {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return undefined; }
  }
  return undefined;
}

export const manageMediaTool: SkillToolDefinition = {
  name: 'manage_media',
  description:
    'Add or remove media (images/videos) from products in a GoDaddy Commerce store.',
  parameters: z.object({
    action: z.enum(['addMedia', 'removeMedia']).describe('The action to perform'),
    storeId: z.string().describe('The store ID'),
    skuGroupId: z.string().describe('SKU group (product) ID'),
    mediaUrl: z.string().optional().describe('Single media URL to add (shortcut for one image)'),
    mediaType: z.enum(['PHOTO', 'VIDEO', 'IMAGE']).optional().describe('Media type when using mediaUrl'),
    mediaLabel: z.string().optional().describe('Media label when using mediaUrl'),
    mediaObjects: z.any().optional().describe('Array of media objects [{url, type, label?, name?}] for addMedia'),
    mediaObjectIds: z.any().optional().describe('Array of media object IDs to remove for removeMedia'),
  }),
  execute: async (input: any, context?: any) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      switch (input.action) {
        case 'addMedia': {
          // Build mediaObjects from either the array or the single-url shortcut
          let mediaObjects = coerceMediaObjects(input.mediaObjects);
          if (!mediaObjects?.length && input.mediaUrl) {
            mediaObjects = [{ url: input.mediaUrl, type: normalizeMediaType(input.mediaType), ...(input.mediaLabel && { label: input.mediaLabel }) }];
          }
          if (!input.skuGroupId || !mediaObjects?.length) {
            throw new Error('skuGroupId and mediaObjects (or mediaUrl) are required for addMedia');
          }
          const response = await godaddy.addMediaObjectsToSkuGroup(
            { storeId: input.storeId, skuGroupId: input.skuGroupId, mediaObjects },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to add media: ${response.error}`);
          }
          return { skuGroup: response.data.addMediaObjectsToSkuGroup };
        }

        case 'removeMedia': {
          const mediaObjectIds = coerceStringArray(input.mediaObjectIds);
          if (!input.skuGroupId || !mediaObjectIds?.length) {
            throw new Error('skuGroupId and mediaObjectIds are required for removeMedia');
          }
          const response = await godaddy.removeMediaObjectsFromSkuGroup(
            { storeId: input.storeId, skuGroupId: input.skuGroupId, mediaObjectIds },
            accessToken,
          );
          if (!response.success) {
            throw new Error(`Failed to remove media: ${response.error}`);
          }
          return { skuGroup: response.data.removeMediaObjectsFromSkuGroup };
        }

        default:
          throw new Error(`Unknown action: ${input.action}`);
      }
    });

    return withManageLinks(authResult, input.storeId);
  },
};

// ============================================================================
// get_orders
// ============================================================================

export const getOrdersTool: SkillToolDefinition = {
  name: 'get_orders',
  description:
    'Fetch orders for a GoDaddy Commerce store. Pass orderId to fetch a single order, or omit it to list orders with pagination. Use `pageToken` to fetch subsequent pages.',
  parameters: z.object({
    storeId: z.string().describe('The store ID to fetch orders from'),
    orderId: z.string().optional().describe('Specific order ID to fetch (omit for list)'),
    pageSize: z.coerce.number().int().min(1).max(100).optional().describe('Maximum number of orders per page (default 20, max 100)'),
    pageToken: z.string().optional().describe('Pagination token from a previous response to fetch the next page'),
  }),
  execute: async (
    input: { storeId: string; orderId?: string; pageSize?: number; pageToken?: string },
    context?: any,
  ) => {
    const appId = context?.metadata?.appId as string | undefined;

    if (!appId) {
      return { error: 'App ID is required. Pass context.metadata.appId.' };
    }

    const authResult = await withCommerceAuth(appId, async (accessToken) => {
      // Single order fetch
      if (input.orderId) {
        const response = await godaddy.getOrder(
          { storeId: input.storeId, orderId: input.orderId },
          accessToken,
        );

        if (!response.success) {
          throw new Error(`Failed to fetch order: ${response.error}`);
        }

        return { order: response.data };
      }

      // List orders
      const response = await godaddy.getOrders(
        {
          storeId: input.storeId,
          pageSize: input.pageSize ?? 20,
          pageToken: input.pageToken,
        },
        accessToken,
      );

      if (!response.success) {
        throw new Error(`Failed to fetch orders: ${response.error}`);
      }

      // Extract next page token from links if available
      const nextLink = response.data.links?.find((l: any) => l.rel === 'next');
      const nextPageToken = nextLink ? new URL(nextLink.href, 'https://placeholder').searchParams.get('pageToken') ?? undefined : undefined;

      logger.info('commerce.skill.get_orders.complete', {
        appId,
        storeId: input.storeId,
        orderCount: response.data.orders.length,
      });

      return {
        orders: response.data.orders,
        hasMore: !!nextPageToken,
        ...(nextPageToken && { nextPageToken }),
      };
    });

    return withManageLinks(authResult, input.storeId);
  },
};
