import { logger } from '../logging/index.js';

export interface Product {
  skuId: string;
  title: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  currencyCode?: string;
  label?: string;
  name?: string;
  code?: string;
  status?: string;
  groupId?: string;
  groupLabel?: string;
  groupName?: string;
  groupDescription?: string;
  groupHtmlDescription?: string;
  groupStatus?: string;
  groupType?: string;
  groupPriceRange?: {
    min: number;
    max: number;
  };
}

export interface GetProductsResult {
  success: boolean;
  products?: Product[];
  error?: string;
  totalCount?: number;
  pageInfo?: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface GraphQLPriceNode {
  id: string;
  value: {
    value: number;
    currencyCode: string;
  };
  compareAtValue?: {
    value: number;
    currencyCode: string;
  };
}

interface GraphQLSkuNode {
  id: string;
  label: string;
  name: string;
  code?: string;
  description?: string;
  status?: string;
  prices: {
    edges: Array<{
      node: GraphQLPriceNode;
    }>;
  };
}

interface GraphQLSkuGroupNode {
  id: string;
  label: string;
  name: string;
  description?: string;
  htmlDescription?: string;
  status?: string;
  type?: string;
  priceRange?: {
    min: number;
    max: number;
  };
  compareAtPriceRange?: {
    min: number;
    max: number;
  };
  skus: {
    edges: Array<{
      node: GraphQLSkuNode;
    }>;
  };
}

interface GraphQLResponse {
  data: {
    skuGroups: {
      edges: Array<{
        node: GraphQLSkuGroupNode;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
      totalCount: number;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

export class CommerceProductTool {
  private clientId: string;
  private clientSecret: string;
  private apiBaseUrl: string;
  private storeId: string;

  constructor() {
    this.clientId = process.env.COMMERCE_CLIENT_ID || '';
    this.clientSecret = process.env.COMMERCE_CLIENT_SECRET || '';
    this.apiBaseUrl = process.env.GODADDY_API_BASE_URL || 'https://api.dev-godaddy.com';
    this.storeId = process.env.COMMERCE_STORE_ID || '';

    if (!this.clientId || !this.clientSecret || !this.storeId) {
      logger.warn('commerce.tool.config.incomplete', {
        hasClientId: !!this.clientId,
        hasClientSecret: !!this.clientSecret,
        hasStoreId: !!this.storeId,
      });
    }
  }

  private async getAccessToken(): Promise<string> {
    logger.info('commerce.oauth.token.request.start', {
      clientId: this.clientId.substring(0, 8) + '...',
    });

    try {
      const tokenUrl = `${this.apiBaseUrl}/v2/oauth2/token`;

      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'commerce.product:read',
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('commerce.oauth.token.request.failure', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}`);
      }

      const tokenData = await response.json() as OAuthTokenResponse;

      logger.info('commerce.oauth.token.request.success', {
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope,
      });

      return tokenData.access_token;
    } catch (error) {
      logger.error('commerce.oauth.token.request.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async fetchProductsFromGraphQL(accessToken: string): Promise<{
    products: Product[];
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
    totalCount: number;
  }> {
    logger.info('commerce.graphql.products.request.start', {
      storeId: this.storeId,
    });

    try {
      const graphqlUrl = `${this.apiBaseUrl}/v2/commerce/stores/${this.storeId}/catalog-subgraph`;

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
                skus {
                  edges {
                    node {
                      id
                      label
                      name
                      code
                      description
                      status
                      prices {
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
          'Authorization': `Bearer ${accessToken}`,
          'x-store-id': this.storeId,
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('commerce.graphql.products.request.failure', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const graphqlData = await response.json() as GraphQLResponse;

      if (graphqlData.errors && graphqlData.errors.length > 0) {
        const errorMessages = graphqlData.errors.map(e => e.message).join(', ');
        logger.error('commerce.graphql.products.request.graphql_errors', {
          errors: errorMessages,
        });
        throw new Error(`GraphQL errors: ${errorMessages}`);
      }

      const products: Product[] = [];

      if (graphqlData.data?.skuGroups?.edges) {
        for (const groupEdge of graphqlData.data.skuGroups.edges) {
          const group = groupEdge.node;

          if (group.skus?.edges) {
            for (const skuEdge of group.skus.edges) {
              const sku = skuEdge.node;

              let price = 0;
              let compareAtPrice: number | undefined;
              let currencyCode = 'USD';

              if (sku.prices?.edges && sku.prices.edges.length > 0) {
                const firstPriceEdge = sku.prices.edges[0];
                if (firstPriceEdge) {
                  const firstPrice = firstPriceEdge.node;
                  price = firstPrice.value?.value || 0;
                  currencyCode = firstPrice.value?.currencyCode || 'USD';
                  compareAtPrice = firstPrice.compareAtValue?.value;
                }
              }

              const skuTitle = sku.label || sku.name || 'Untitled Product';
              const description = sku.description || group.description || group.label || group.name || 'No description available';

              const product: Product = {
                skuId: sku.id,
                title: skuTitle,
                description,
                price,
                currencyCode,
                label: sku.label,
                name: sku.name,
                groupId: group.id,
                groupLabel: group.label,
                groupName: group.name,
              };

              if (compareAtPrice !== undefined) {
                product.compareAtPrice = compareAtPrice;
              }
              if (sku.code) {
                product.code = sku.code;
              }
              if (sku.status) {
                product.status = sku.status;
              }
              if (group.description) {
                product.groupDescription = group.description;
              }
              if (group.htmlDescription) {
                product.groupHtmlDescription = group.htmlDescription;
              }
              if (group.status) {
                product.groupStatus = group.status;
              }
              if (group.type) {
                product.groupType = group.type;
              }
              if (group.priceRange) {
                product.groupPriceRange = group.priceRange;
              }

              products.push(product);
            }
          }
        }
      }

      logger.info('commerce.graphql.products.request.success', {
        productCount: products.length,
        totalCount: graphqlData.data.skuGroups.totalCount,
        hasNextPage: graphqlData.data.skuGroups.pageInfo.hasNextPage,
      });

      return {
        products,
        pageInfo: graphqlData.data.skuGroups.pageInfo,
        totalCount: graphqlData.data.skuGroups.totalCount,
      };
    } catch (error) {
      logger.error('commerce.graphql.products.request.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getProducts(): Promise<GetProductsResult> {
    logger.info('commerce.tool.get_products.start', {});

    if (!this.clientId || !this.clientSecret || !this.storeId) {
      const error = 'Commerce tool is not properly configured. Missing required environment variables.';
      logger.error('commerce.tool.get_products.config_error', {
        hasClientId: !!this.clientId,
        hasClientSecret: !!this.clientSecret,
        hasStoreId: !!this.storeId,
      });
      return {
        success: false,
        error,
      };
    }

    try {
      const accessToken = await this.getAccessToken();
      const result = await this.fetchProductsFromGraphQL(accessToken);

      logger.info('commerce.tool.get_products.success', {
        productCount: result.products.length,
        totalCount: result.totalCount,
        hasNextPage: result.pageInfo.hasNextPage,
      });

      return {
        success: true,
        products: result.products,
        totalCount: result.totalCount,
        pageInfo: result.pageInfo,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('commerce.tool.get_products.failure', {
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export async function getProducts(): Promise<GetProductsResult> {
  const tool = new CommerceProductTool();
  return tool.getProducts();
}
