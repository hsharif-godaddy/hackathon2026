import { v4 as uuid } from 'uuid';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'godaddy-commerce' });

/**
 * Money input type for prices
 */
export interface SimpleMoneyInput {
  currencyCode: string;
  value: number;
}

/**
 * SKU price input
 */
export interface CreateSKUPriceInput {
  value: SimpleMoneyInput;
  compareAtValue?: SimpleMoneyInput;
}

/**
 * Media object input
 */
export interface CreateMediaObjectInput {
  type: 'PHOTO' | 'VIDEO' | 'IMAGE';
  url: string;
  label?: string;
  name?: string;
  position?: number;
}

/**
 * SKU within a SKU Group
 */
export interface CreateSKUGroupSKUInput {
  label: string;
  name?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  code?: string;
  description?: string;
  htmlDescription?: string;
  shortLabel?: string;
  prices?: CreateSKUPriceInput[];
  unitCost?: SimpleMoneyInput;
  weight?: number;
  unitOfWeight?: 'KG' | 'GR' | 'LB' | 'OZ';
  mediaObjects?: CreateMediaObjectInput[];
  disableInventoryTracking?: boolean;
  disablePriceOverrides?: boolean;
  disableShipping?: boolean;
  backorderLimit?: number;
}

/**
 * SKU Group creation input
 */
export interface CreateSkuGroupInput {
  label: string;
  type: string;
  name?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  description?: string;
  htmlDescription?: string;
  shortLabel?: string;
  skus?: CreateSKUGroupSKUInput[];
  mediaObjects?: CreateMediaObjectInput[];
}

/**
 * Price range response
 */
export interface PriceRange {
  min: number;
  max: number;
}

/**
 * Money object from GraphQL
 */
export interface SimpleMoney {
  value: number;
  currencyCode: string;
}

/**
 * SKU Price response
 */
export interface SKUPriceResponse {
  id: string;
  value: SimpleMoney;
  compareAtValue?: SimpleMoney;
}

/**
 * SKU response
 */
export interface SKUResponse {
  id: string;
  label: string;
  name: string;
  code?: string;
  status: string;
  prices?: {
    edges: Array<{
      node: SKUPriceResponse;
    }>;
  };
}

/**
 * SKU Group response from GraphQL
 */
export interface SKUGroupResponse {
  id: string;
  label: string;
  name: string;
  description?: string;
  htmlDescription?: string;
  status: string;
  type: string;
  priceRange?: PriceRange;
  compareAtPriceRange?: PriceRange;
  createdAt?: string;
  updatedAt?: string;
  skus?: {
    edges: Array<{
      node: SKUResponse;
    }>;
  };
}

/**
 * GraphQL SKU Groups query response
 */
export interface GetSkuGroupsResponse {
  success: boolean;
  data?: {
    skuGroups: {
      edges: Array<{
        node: SKUGroupResponse;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor?: string;
        endCursor?: string;
      };
      totalCount: number;
    };
  };
  error?: string;
}

/**
 * GraphQL create SKU Group mutation response
 */
export interface CreateSkuGroupResponse {
  success: boolean;
  data?: {
    createSkuGroup: SKUGroupResponse;
  };
  error?: string;
}

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
    args: { appId: string; customerId: string; email: string; firstName: string; lastName: string },
    accessToken: string
  ): Promise<unknown> {
    if (!this.baseUrl) {
      throw new Error('Godaddy base url not set');
    }

    const url = 'https://signup.payments.dev-godaddy.com/api/v1/commerce/onboarding-applications';
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

    const data = await result.json();

    if (!result.ok) {
      throw new Error(
        `Commerce onboarding API error (${result.status}): ${JSON.stringify(data)}`
      );
    }

    return data;
  }

  public async getSkuGroups(args: { storeId: string }, accessToken: string) {
    const graphqlUrl = `${this.baseUrl}/v2/commerce/stores/${args.storeId}/catalog-subgraph`;

    const query = `
        query GetProducts {
          skuGroups(first: 20) {
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
    args: { storeId: string; product: CreateSkuGroupInput },
    accessToken: string
  ) {
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
}
