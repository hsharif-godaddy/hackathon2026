/**
 * GraphQL API Client for Product Graph
 *
 * Provides authenticated GraphQL queries and mutations for venture management.
 * Uses JWT tokens from customer authentication for API authorization.
 */

import { logger } from '@/lib/request-context';

export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{
        message: string;
        locations?: Array<{ line: number; column: number }>;
        path?: Array<string | number>;
        extensions?: Record<string, unknown>;
    }>;
}

export interface GraphQLRequest {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
}

/**
 * GraphQL client for making authenticated requests
 */
export class GraphQLClient {
    private endpoint: string;
    private getAuthToken: () => Promise<string | null>;

    /**
     * Create a GraphQL client instance
     *
     * @param endpoint - GraphQL API endpoint URL
     * @param getAuthToken - Function to retrieve authentication token
     */
    constructor(
        endpoint: string,
        getAuthToken: () => Promise<string | null>
    ) {
        this.endpoint = endpoint;
        this.getAuthToken = getAuthToken;
    }

    /**
     * Execute a GraphQL query or mutation
     *
     * @param request - GraphQL request with query and variables
     * @returns Promise resolving to GraphQL response
     *
     * @throws {Error} If request fails or authentication is invalid
     */
    async request<T>(request: GraphQLRequest): Promise<GraphQLResponse<T>> {
        const token = await this.getAuthToken();

        if (!token) {
            throw new Error('Authentication token not available');
        }

        const appKey = getGraphQLAppKey();

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `sso-jwt ${token}`,
            'X-App-Key': appKey,
        };

        logger.debug('graphql.request.start', {
            operationName: request.operationName,
            endpoint: this.endpoint,
            hasToken: !!token,
            hasAppKey: !!appKey,
        });

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('graphql.request.failed', {
                message: 'GraphQL request failed',
                status: response.status,
                statusText: response.statusText,
                error: errorText,
            });

            throw new Error(
                `GraphQL request failed: ${response.status} ${response.statusText}`
            );
        }

        const result: GraphQLResponse<T> = await response.json();

        if (result.errors && result.errors.length > 0) {
            const errorMessages = result.errors.map((e) => e.message).join(', ');
            logger.error('graphql.errors', {
                message: 'GraphQL response contains errors',
                errors: result.errors,
            });

            throw new Error(`GraphQL errors: ${errorMessages}`);
        }

        return result;
    }
}

/**
 * Get GraphQL endpoint from environment or use default
 *
 * @returns GraphQL API endpoint URL
 */
export function getGraphQLEndpoint(): string {
    return (
        process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT ||
        process.env.GRAPHQL_ENDPOINT ||
        'https://pg.api.test-godaddy.com/v1/gql/app'
    );
}

/**
 * Get GraphQL app key from environment
 *
 * @returns GraphQL app key for X-App-Key header
 *
 * @throws {Error} If GRAPHQL_APP_KEY is not configured
 */
export function getGraphQLAppKey(): string {
    const appKey = process.env.GRAPHQL_APP_KEY || 'airo-app-builder';
    if (!appKey) {
        throw new Error('GRAPHQL_APP_KEY environment variable is required');
    }
    return appKey;
}

/**
 * Create a GraphQL client with authentication
 *
 * @param getAuthToken - Function to get auth token (server-side or client-side)
 * @returns GraphQL client instance
 */
export function createGraphQLClient(
    getAuthToken: () => Promise<string | null>
): GraphQLClient {
    const endpoint = getGraphQLEndpoint();
    return new GraphQLClient(endpoint, getAuthToken);
}

/**
 * Create a GraphQL client with certificate-based S2S authentication
 *
 * @returns GraphQL client instance configured for S2S token authentication
 */
export async function createGraphQLClientWithS2SAuth(): Promise<GraphQLClient> {
    const { certTokenService } = await import('./cert-token-service');
    const endpoint = getGraphQLEndpoint();

    const getToken = async () => {
        try {
            return await certTokenService.getToken();
        } catch (error) {
            logger.error('graphql.s2s-token.failed', {
                message: 'Failed to get certificate-based S2S token for GraphQL',
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    };

    return new GraphQLClient(endpoint, getToken);
}
