import { v4 as uuid } from 'uuid';
import { Logger } from '../logging/index.js';
import type {
  CommerceOnboardingApplicationResponse,
  MutationCreateSkuGroupInput,
  MutationUpdateSkuGroupInput,
  MutationUpdateSkuInput,
  MutationAdjustInventoryInput,
  MutationStockInventoryInput,
  MutationCreateLocationInput,
  GetSkuGroupsResponse as GraphQLGetSkuGroupsResponse,
  CreateSkuGroupResponse as GraphQLCreateSkuGroupResponse,
  UpdateSkuGroupResponse as GraphQLUpdateSkuGroupResponse,
  UpdateSkuResponse as GraphQLUpdateSkuResponse,
  DeleteSkuGroupResponse as GraphQLDeleteSkuGroupResponse,
  GetInventoryCountsResponse as GraphQLGetInventoryCountsResponse,
  AdjustInventoryResponse as GraphQLAdjustInventoryResponse,
  StockInventoryResponse as GraphQLStockInventoryResponse,
  GetLocationsResponse as GraphQLGetLocationsResponse,
  CreateLocationResponse as GraphQLCreateLocationResponse,
  AddMediaObjectsToSkuGroupResponse as GraphQLAddMediaObjectsToSkuGroupResponse,
  RemoveMediaObjectsFromSkuGroupResponse as GraphQLRemoveMediaObjectsFromSkuGroupResponse,
  InventoryCountResponse,
  InventoryAdjustmentResponse,
  LocationResponse,
  SKUGroupResponse,
  SKUResponse,
  SKUPriceResponse,
  SimpleMoneyInput,
  SimpleMoney,
  PriceRange,
  CreateSKUPriceInput,
  CreateMediaObjectInput,
  CreateSKUGroupSKUInput,
  MediaObjectResponse
} from './godaddy-commerce-types.js';

const logger = Logger.create({ service: 'godaddy-commerce' });

// Re-export types for backward compatibility
export type {
  SimpleMoneyInput,
  CreateSKUPriceInput,
  CreateMediaObjectInput,
  CreateSKUGroupSKUInput,
  PriceRange,
  SimpleMoney,
  SKUPriceResponse,
  SKUResponse,
  SKUGroupResponse,
  CommerceOnboardingApplicationResponse,
  InventoryCountResponse,
  InventoryAdjustmentResponse,
  LocationResponse,
  MutationAdjustInventoryInput,
  MutationStockInventoryInput,
  MediaObjectResponse
};

// Aliases for backward compatibility
export type CreateSkuGroupInput = MutationCreateSkuGroupInput;
export type UpdateSkuGroupInput = MutationUpdateSkuGroupInput;
export type UpdateSkuInput = MutationUpdateSkuInput;

/**
 * GraphQL SKU Groups query response wrapper
 */
export type GetSkuGroupsResponse =
  | { success: true; data: GraphQLGetSkuGroupsResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL create SKU Group mutation response wrapper
 */
export type CreateSkuGroupResponse =
  | { success: true; data: GraphQLCreateSkuGroupResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL update SKU Group mutation response wrapper
 */
export type UpdateSkuGroupResponse =
  | { success: true; data: GraphQLUpdateSkuGroupResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL update SKU mutation response wrapper
 */
export type UpdateSkuResponse =
  | { success: true; data: GraphQLUpdateSkuResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL delete SKU Group mutation response wrapper
 */
export type DeleteSkuGroupResponse =
  | { success: true; data: GraphQLDeleteSkuGroupResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL get inventory counts query response wrapper
 */
export type GetInventoryCountsResponse =
  | { success: true; data: GraphQLGetInventoryCountsResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL adjust inventory mutation response wrapper
 */
export type AdjustInventoryResponse =
  | { success: true; data: GraphQLAdjustInventoryResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL stock inventory mutation response wrapper
 */
export type StockInventoryResponse =
  | { success: true; data: GraphQLStockInventoryResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL get locations query response wrapper
 */
export type GetLocationsResponse =
  | { success: true; data: GraphQLGetLocationsResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL create location mutation response wrapper
 */
export type CreateLocationResponse =
  | { success: true; data: GraphQLCreateLocationResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL add media objects to SKU group mutation response wrapper
 */
export type AddMediaObjectsToSkuGroupResponse =
  | { success: true; data: GraphQLAddMediaObjectsToSkuGroupResponse; error?: never }
  | { success: false; data?: never; error: string };

/**
 * GraphQL remove media objects from SKU group mutation response wrapper
 */
export type RemoveMediaObjectsFromSkuGroupResponse =
  | { success: true; data: GraphQLRemoveMediaObjectsFromSkuGroupResponse; error?: never }
  | { success: false; data?: never; error: string };

export class GoDaddyCommerce {
  private baseUrl: string | undefined;
  private baseHeaders: Record<string, string>;

  constructor() {
    this.baseUrl = process.env.GODADDY_API_BASE_URL;
    this.baseHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'GoDaddy: Airo App Builder Agent',
      Accept: 'application/json',
      'X-Client-Version': '1.0.0',
    };
  }

  private getCommerceDomain(): string {
    if (!this.baseUrl) {
      return 'godaddy.com';
    }
    const hostname = new URL(this.baseUrl).hostname;
    return hostname.replace(/^api\./, '');
  }

  public getStoreManagementUrl(storeId: string): string {
    const domain = this.getCommerceDomain();
    return `https://spa.commerce.${domain}/home/store?store=${storeId}`;
  }

  public getCatalogManagementUrl(storeId: string): string {
    const domain = this.getCommerceDomain();
    return `https://spa.commerce.${domain}/products?store=${storeId}`;
  }

  public async getStoreSummary(
    args: { customerId: string },
    accessToken: string
  ): Promise<unknown> {
    if (!this.baseUrl) {
      throw new Error('Godaddy base url not set');
    }

    const result = await fetch(
      `${this.baseUrl}/v1/commerce/stores-summary?customerId=${args.customerId}`,
      {
        headers: {
          ...this.baseHeaders,
          Authorization: `Bearer ${accessToken}`,
          'X-Request-ID': uuid(),
        },
      }
    );
    const data = await result.json();

    return data;
  }

  public async onboardApplication(
    args: { appId: string; customerId: string; storeName?: string | undefined; email: string; firstName: string; lastName: string },
    accessToken: string
  ) {
    if (!this.baseUrl) {
      throw new Error('Godaddy base url not set');
    }

    const hostname = new URL(this.baseUrl).hostname;
    const domain = hostname.replace(/^api\./, '');
    let queryParams = '';

    if (domain.includes('dev-') || domain.includes('test-')) {
      queryParams = '?mock=true';
    }
    const url = `https://signup.payments.${domain}/api/v1/commerce/onboarding-applications${queryParams}`;
    const requestId = uuid();
    const requestBody = {
      individuals: [
        {
          customerId: args.customerId,
          email: args.email,
          firstName: args.firstName,
          lastName: args.lastName,
          type: 'APPLICANT',
        },
      ],
      company: {
        address: {
          countryCode: 'US',
        },
        ...(args.storeName && { legalName: args.storeName }),
      },
      metadata: {
        source: 'GoDaddy - Airo App Builder Agent',
        appId: args.appId,
      },
      intent: 'CREATE_BUSINESS',
      products: [
        {
          name: 'PAYMENTS',
        },
      ],
    };

    const result = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.baseHeaders,
        Authorization: `Bearer ${accessToken}`,
        'X-Request-ID': requestId,
        'X-Reference-ID': args.appId,
        'X-Reference-Name': 'Airo Builder',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await result.json() as CommerceOnboardingApplicationResponse;

    if (!result.ok) {
      throw new Error(`Commerce onboarding API error (${result.status}): ${JSON.stringify(data)}`);
    }

    return data;
  }

  public async enableGoDaddyPaymentsApplication(args: { storeId: string }, accessToken: string) {
    const graphqlUrl = `${this.baseUrl}/v1/apps/app-registry-subgraph`;

    const query = `
    mutation EnableGoDaddyPaymentsApplication($storeId: String!) {
      enableStoreApplication(input: { applicationName: "godaddy-payments", storeId: $storeId }) {
        id
        name
        status
        url
      }
    }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          storeId: args.storeId,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL request failed: ${data.errors[0].message}`);
    }

    return data;
  }

  /**
   * Enable Catalog V2 for a store
   *
   * This converts the store to use Commerce Catalog V2, which should be done
   * immediately after store onboarding and before loading any products.
   *
   * @param args - Object containing storeId
   * @param accessToken - OAuth access token
   * @throws Error if the API request fails
   */
  public async enableCatalogV2(args: { storeId: string }, accessToken: string): Promise<void> {
    if (!this.baseUrl) {
      throw new Error('Godaddy base url not set');
    }

    const hostname = new URL(this.baseUrl).hostname;
    const domain = hostname.replace(/^api\./, '');
    const url = `https://catalog.commerce.${domain}/v1/commerce/catalog/internal/stores/${args.storeId}/eligibleVersion`;

    logger.info('godaddy_commerce.enable_catalog_v2.start', {
      storeId: args.storeId,
      url,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.baseHeaders,
        Authorization: `Bearer ${accessToken}`,
        'X-Request-ID': uuid(),
      },
      body: JSON.stringify({
        useCatalogV2: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('godaddy_commerce.enable_catalog_v2.failure', {
        storeId: args.storeId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`Failed to enable Catalog V2 for store ${args.storeId}: ${response.status} ${response.statusText} - ${errorText}`);
    }

    logger.info('godaddy_commerce.enable_catalog_v2.success', {
      storeId: args.storeId,
    });
  }

  public async getSkuGroups(args: { storeId: string; first?: number; after?: string | undefined; query?: string | undefined }, accessToken: string): Promise<GetSkuGroupsResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
        query GetProducts($first: Int, $after: String) {
          skuGroups(status: { eq: "ACTIVE" }, first: $first, after: $after) {
            edges {
              node {
                id
                label
                name
                description
                htmlDescription
                status
                type
                priceRange {
                  min
                  max
                }
                compareAtPriceRange {
                  min
                  max
                }
                skus (first: 2) {
                  edges {
                    node {
                      id
                      name
                      prices {
                        edges {
                          node {
                            value {
                              value
                              currencyCode
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            totalCount
          }
        }
      `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query,
        variables: {
          first: args.first || 20,
          after: args.after,
          label: args.query ? { contains: args.query } : null,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    // GraphQL returns { data, errors } structure
    if (data.errors) {
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async createSkuGroup(
    args: { storeId: string; product: MutationCreateSkuGroupInput },
    accessToken: string
  ): Promise<CreateSkuGroupResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation CreateSkuGroup($input: MutationCreateSkuGroupInput!) {
        createSkuGroup(input: $input) {
          id
          label
          name
          description
          htmlDescription
          status
          type
          priceRange {
            min
            max
          }
          compareAtPriceRange {
            min
            max
          }
          createdAt
          updatedAt
          skus(first: 50) {
            edges {
              node {
                id
                label
                name
                code
                status
                prices(first: 10) {
                  edges {
                    node {
                      id
                      value {
                        value
                        currencyCode
                      }
                      compareAtValue {
                        value
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const requestBody = {
      query: mutation,
      variables: {
        input: args.product,
      },
    };

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.create-sku-group.request-failed', {
        storeId: args.storeId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    // GraphQL returns { data, errors } structure
    if (data.errors) {
      logger.error('commerce.create-sku-group.graphql-errors', {
        storeId: args.storeId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async getSkuGroup(
    args: { storeId: string; skuGroupId: string },
    accessToken: string
  ): Promise<{ success: boolean; data?: { skuGroup: SKUGroupResponse }; error?: string }> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
      query GetSkuGroup($id: String!) {
        skuGroup(id: $id) {
          id
          label
          name
          description
          htmlDescription
          status
          type
          priceRange {
            min
            max
          }
          compareAtPriceRange {
            min
            max
          }
          createdAt
          updatedAt
          skus(first: 50) {
            edges {
              node {
                id
                label
                name
                code
                status
                prices(first: 1) {
                  edges {
                    node {
                      id
                      value {
                        value
                        currencyCode
                      }
                      compareAtValue {
                        value
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query,
        variables: { id: args.skuGroupId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.get-sku-group.request-failed', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.get-sku-group.graphql-errors', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async updateSkuGroup(
    args: { storeId: string; skuGroupId: string; product: MutationUpdateSkuGroupInput },
    accessToken: string
  ): Promise<UpdateSkuGroupResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation UpdateSkuGroup($id: String!, $input: MutationUpdateSkuGroupInput!) {
        updateSkuGroup(id: $id, input: $input) {
          id
          label
          name
          description
          htmlDescription
          status
          type
          priceRange {
            min
            max
          }
          compareAtPriceRange {
            min
            max
          }
          createdAt
          updatedAt
          skus(first: 50) {
            edges {
              node {
                id
                label
                name
                code
                status
                prices(first: 1) {
                  edges {
                    node {
                      id
                      value {
                        value
                        currencyCode
                      }
                      compareAtValue {
                        value
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          id: args.skuGroupId,
          input: args.product,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.update-sku-group.request-failed', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.update-sku-group.graphql-errors', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async updateSku(
    args: { storeId: string; skuId: string; product: MutationUpdateSkuInput },
    accessToken: string
  ): Promise<UpdateSkuResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation UpdateSku($id: String!, $input: MutationUpdateSkuInput!) {
        updateSku(id: $id, input: $input) {
          id
          label
          name
          code
          status
          prices(first: 10) {
            edges {
              node {
                id
                value {
                  value
                  currencyCode
                }
                compareAtValue {
                  value
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          id: args.skuId,
          input: args.product,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.update-sku.request-failed', {
        storeId: args.storeId,
        skuId: args.skuId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.update-sku.graphql-errors', {
        storeId: args.storeId,
        skuId: args.skuId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async deleteSkuGroup(
    args: { storeId: string; skuGroupId: string },
    accessToken: string
  ): Promise<DeleteSkuGroupResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation DeleteSkuGroup($id: String!) {
        deleteSkuGroupById(id: $id) {
          id
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: { id: args.skuGroupId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.delete-sku-group.request-failed', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.delete-sku-group.graphql-errors', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async getInventoryCounts(
    args: { storeId: string; skuId?: string; locationId?: string; first?: number },
    accessToken: string
  ): Promise<GetInventoryCountsResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
      query GetInventoryCounts($skuId: SKUIdFilter, $locationId: LocationIdFilter, $first: Int) {
        inventoryCounts(skuId: $skuId, locationId: $locationId, first: $first, type: { eq: "AVAILABLE" }) {
          edges {
            node {
              id
              quantity
              type
              onHand
              createdAt
              updatedAt
              sku {
                id
                label
                name
              }
              location {
                id
                label
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query,
        variables: {
          skuId: args.skuId ? { eq: args.skuId } : undefined,
          locationId: args.locationId ? { eq: args.locationId } : undefined,
          first: args.first || 50,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.get-inventory-counts.request-failed', {
        storeId: args.storeId,
        skuId: args.skuId,
        locationId: args.locationId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.get-inventory-counts.graphql-errors', {
        storeId: args.storeId,
        skuId: args.skuId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async adjustInventory(
    args: { storeId: string; skuId: string; locationId: string; delta: number },
    accessToken: string
  ): Promise<AdjustInventoryResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation AdjustInventory($input: MutationAdjustInventoryInput!) {
        adjustInventory(input: $input) {
          id
          delta
          type
          createdAt
          occurredAt
          sku {
            id
            label
            name
          }
          location {
            id
            label
            name
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            skuId: args.skuId,
            locationId: args.locationId,
            delta: args.delta,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.adjust-inventory.request-failed', {
        storeId: args.storeId,
        skuId: args.skuId,
        locationId: args.locationId,
        delta: args.delta,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.adjust-inventory.graphql-errors', {
        storeId: args.storeId,
        skuId: args.skuId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async stockInventory(
    args: { storeId: string; skuId: string; locationId: string; quantity: number },
    accessToken: string
  ): Promise<StockInventoryResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation StockInventory($input: MutationStockInventoryInput!) {
        stockInventory(input: $input) {
          id
          delta
          type
          createdAt
          occurredAt
          sku {
            id
            label
            name
          }
          location {
            id
            label
            name
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            skuId: args.skuId,
            locationId: args.locationId,
            quantity: args.quantity,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.stock-inventory.request-failed', {
        storeId: args.storeId,
        skuId: args.skuId,
        locationId: args.locationId,
        quantity: args.quantity,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.stock-inventory.graphql-errors', {
        storeId: args.storeId,
        skuId: args.skuId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async getLocations(
    args: { storeId: string; first?: number; status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' },
    accessToken: string
  ): Promise<GetLocationsResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
      query GetLocations($first: Int, $status: LocationStatusFilter) {
        locations(first: $first, status: $status) {
          edges {
            node {
              id
              label
              name
              status
              address {
                addressLine1
                addressLine2
                adminArea1
                adminArea2
                postalCode
                countryCode
              }
              createdAt
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query,
        variables: {
          first: args.first || 50,
          status: args.status ? { eq: args.status } : { eq: 'ACTIVE' },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.get-locations.request-failed', {
        storeId: args.storeId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.get-locations.graphql-errors', {
        storeId: args.storeId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async createLocation(
    args: { storeId: string; location: MutationCreateLocationInput },
    accessToken: string
  ): Promise<CreateLocationResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation CreateLocation($input: MutationCreateLocationInput!) {
        createLocation(input: $input) {
          id
          label
          name
          status
          address {
            addressLine1
            addressLine2
            adminArea1
            adminArea2
            postalCode
            countryCode
          }
          createdAt
          updatedAt
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: args.location,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.create-location.request-failed', {
        storeId: args.storeId,
        label: args.location.label,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.create-location.graphql-errors', {
        storeId: args.storeId,
        label: args.location.label,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async addMediaObjectsToSkuGroup(
    args: { storeId: string; skuGroupId: string; mediaObjects: CreateMediaObjectInput[] },
    accessToken: string
  ): Promise<AddMediaObjectsToSkuGroupResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation AddMediaObjectsToSkuGroup($id: String!, $input: MutationAddMediaObjectsToSkuGroupInput!) {
        addMediaObjectsToSkuGroup(id: $id, input: $input) {
          id
          label
          name
          status
          mediaObjects(first: 50) {
            edges {
              node {
                id
                label
                name
                position
                type
                url
              }
            }
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          id: args.skuGroupId,
          input: {
            mediaObjects: args.mediaObjects,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.add-media-objects-to-sku-group.request-failed', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.add-media-objects-to-sku-group.graphql-errors', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }

  public async removeMediaObjectsFromSkuGroup(
    args: { storeId: string; skuGroupId: string; mediaObjectIds: string[] },
    accessToken: string
  ): Promise<RemoveMediaObjectsFromSkuGroupResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const mutation = `
      mutation RemoveMediaObjectsFromSkuGroup($id: String!, $input: MutationRemoveMediaObjectsFromSkuGroupInput!) {
        removeMediaObjectsFromSkuGroup(id: $id, input: $input) {
          id
          label
          name
          status
          mediaObjects(first: 50) {
            edges {
              node {
                id
                label
                name
                position
                type
                url
              }
            }
          }
        }
      }
    `;

    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-store-id': args.storeId,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          id: args.skuGroupId,
          input: {
            mediaObjectIds: args.mediaObjectIds,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('commerce.remove-media-objects-from-sku-group.request-failed', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('commerce.remove-media-objects-from-sku-group.graphql-errors', {
        storeId: args.storeId,
        skuGroupId: args.skuGroupId,
        errors: data.errors.map((e: any) => e.message),
      });
      return {
        success: false,
        error: data.errors.map((e: any) => e.message).join(', '),
      };
    }

    return {
      success: true,
      data: data.data,
    };
  }
}
