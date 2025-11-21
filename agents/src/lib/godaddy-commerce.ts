import { v4 as uuid } from 'uuid';
import { Logger } from '../logging/index.js';
import type {
  CommerceOnboardingApplicationResponse,
  MutationCreateSkuGroupInput,
  MutationUpdateSkuGroupInput,
  GetSkuGroupsResponse as GraphQLGetSkuGroupsResponse,
  CreateSkuGroupResponse as GraphQLCreateSkuGroupResponse,
  UpdateSkuGroupResponse as GraphQLUpdateSkuGroupResponse,
  DeleteSkuGroupResponse as GraphQLDeleteSkuGroupResponse,
  SKUGroupResponse,
  SKUResponse,
  SKUPriceResponse,
  SimpleMoneyInput,
  SimpleMoney,
  PriceRange,
  CreateSKUPriceInput,
  CreateMediaObjectInput,
  CreateSKUGroupSKUInput
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
  CommerceOnboardingApplicationResponse
};

// Aliases for backward compatibility
export type CreateSkuGroupInput = MutationCreateSkuGroupInput;
export type UpdateSkuGroupInput = MutationUpdateSkuGroupInput;

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
 * GraphQL delete SKU Group mutation response wrapper
 */
export type DeleteSkuGroupResponse =
  | { success: true; data: GraphQLDeleteSkuGroupResponse; error?: never }
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
    const url = `https://signup.payments.${domain}/api/v1/commerce/onboarding-applications`;
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

  public async getSkuGroups(args: { storeId: string }, accessToken: string): Promise<GetSkuGroupsResponse> {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
        query GetProducts {
          skuGroups(status: { eq: "ACTIVE" }, first: 20) {
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
      body: JSON.stringify({ query }),
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
}
