/**
 * Venture Management Service
 *
 * Handles fetching and creating venture profiles via GraphQL API.
 */

import { createGraphQLClientWithS2SAuth, GraphQLClient } from './product-graph/client';
import { logger } from '@/lib/request-context';

export interface Profile {
    id: string;
    name?: string;
    logoUrl?: string;
}

/**
 * Service for managing venture data via GraphQL
 */
export class VentureService {
    private client: GraphQLClient;
    private clientPromise: Promise<GraphQLClient> | null = null;

    /**
     * Create venture service instance with certificate-based S2S authentication
     */
    constructor() {
        // Initialize client asynchronously
        this.clientPromise = createGraphQLClientWithS2SAuth();
        this.client = null as any; // Will be set on first use
    }

    /**
     * Ensure client is initialized
     *
     * @returns Promise resolving to GraphQL client
     */
    private async ensureClient(): Promise<GraphQLClient> {
        if (this.clientPromise) {
            this.client = await this.clientPromise;
            this.clientPromise = null;
        }
        return this.client;
    }

    /**
     * Get latest venture for a shopper
     *
     * @param shopperId - Shopper ID
     * @returns Promise resolving to venture ID or null if not found
     *
     * @throws {Error} If GraphQL request fails
     */
    async getLatestShopperVenture(shopperId: string): Promise<string | null> {
        const query = `
      query GetLatestShopperVenture($shopperId: String!) {
        latestShopperVenture(shopperId: $shopperId) {
          id
          profile {
            id
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<{
                latestShopperVenture?: {
                    id: string;
                    profile?: {
                        id: string;
                    };
                };
            }>({
                query,
                variables: { shopperId },
                operationName: 'GetLatestShopperVenture',
            });

            const ventureId = response.data?.latestShopperVenture?.id;
            return ventureId || null;
        } catch (error) {
            logger.error('venture.getLatestShopperVenture.failed', {
                message: 'Failed to get latest shopper venture',
                shopperId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Create a profile for a shopper
     *
     * @param shopperId - Shopper ID
     * @param profile - Optional profile payload
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If mutation fails or venture ID cannot be retrieved
     */
    async createProfileForShopper(
        shopperId: string,
        profile?: {
            name?: string;
            category?: string;
            description?: string;
            logoUrl?: string;
        }
    ): Promise<string> {
        const mutation = `
      mutation CreateProfileForShopper($shopperId: String!, $profile: ProfilePayload) {
        createProfileForShopper(shopperId: $shopperId, profile: $profile) {
          id
          venture {
            id
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<{
                createProfileForShopper?: {
                    id: string;
                    venture?: { id: string };
                };
            }>({
                query: mutation,
                variables: {
                    shopperId,
                    profile: profile || null,
                },
                operationName: 'CreateProfileForShopper',
            });

            const ventureId =
                response.data?.createProfileForShopper?.venture?.id;

            if (!ventureId) {
                throw new Error('Failed to get venture ID from created profile');
            }

            logger.info('venture.createProfile.success', {
                message: 'Successfully created profile',
                shopperId,
                ventureId,
            });

            return ventureId;
        } catch (error) {
            logger.error('venture.createProfile.failed', {
                message: 'Failed to create profile for shopper',
                shopperId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get or create venture for a shopper
     *
     * First tries to get the latest shopper venture. If none exists, creates a new profile.
     *
     * @param shopperId - Shopper ID
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If query or creation fails
     */
    async getOrCreateVentureForShopper(
        shopperId: string
    ): Promise<string> {

        const ventureId = await this.createProfileForShopper(shopperId);

        return ventureId;
    }
}
