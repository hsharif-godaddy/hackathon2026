/**
 * Venture Management Service
 *
 * Handles fetching and creating venture profiles via mgmt-airo attributes API.
 * Falls back to GraphQL API for creating new ventures when needed.
 */

import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { createGraphQLClientWithS2SAuth, GraphQLClient } from './product-graph/client';

export interface Profile {
    id: string;
    name?: string;
    logoUrl?: string;
}

export interface CustomerProjectNode {
    group: string;
    status: string;
    billing: {
        id: string;
        plan: string;
    };
}

export interface CustomerProjectEdge {
    node: CustomerProjectNode;
}

export interface CustomerProjectsPageInfo {
    hasNextPage: boolean;
    endCursor: string;
}

export interface CustomerProjectsResponse {
    projects: {
        edges: CustomerProjectEdge[];
        pageInfo: CustomerProjectsPageInfo;
    };
}

/**
 * Service for managing venture data via mgmt-airo attributes API
 */
export class VentureService {
    private graphqlClient: GraphQLClient;
    private graphqlClientPromise: Promise<GraphQLClient> | null = null;
    private mgmtAiroClient: AiroMgmtClient | null = null;

    /**
     * Create venture service instance
     *
     * @param jwt - Optional JWT token for mgmt-airo API calls. If not provided,
     *              only GraphQL operations will be available.
     */
    constructor(jwt?: string) {
        // Initialize GraphQL client asynchronously (for creating new ventures)
        this.graphqlClientPromise = createGraphQLClientWithS2SAuth();
        this.graphqlClient = null as any; // Will be set on first use

        // Initialize mgmt-airo client if JWT is provided
        if (jwt) {
            const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
            this.mgmtAiroClient = new AiroMgmtClient({
                baseUrl,
                jwt,
                maxRetries: 3,
                retryDelayMs: 1000
            });
        }
    }

    /**
     * Ensure GraphQL client is initialized
     *
     * @returns Promise resolving to GraphQL client
     */
    private async ensureGraphQLClient(): Promise<GraphQLClient> {
        if (this.graphqlClientPromise) {
            this.graphqlClient = await this.graphqlClientPromise;
            this.graphqlClientPromise = null;
        }
        return this.graphqlClient;
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
            const client = await this.ensureGraphQLClient();
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
     * Get or create venture for a customer
     *
     * First tries to get venture ID from mgmt-airo attributes API.
     * If not found, creates a new venture via GraphQL and stores it in mgmt-airo.
     *
     * @param customerId - Customer ID (used as ownerId in mgmt-airo)
     * @param shopperId - Optional shopper ID (used for GraphQL operations)
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If query or creation fails
     */
    async getOrCreateVentureForCustomer(
        customerId: string,
        shopperId?: string
    ): Promise<string> {
        // Step 1: Try to get venture ID from mgmt-airo attributes
        if (this.mgmtAiroClient) {
            try {
                const attribute = await this.mgmtAiroClient.getAttribute(
                    'user',
                    customerId,
                    'ventures'
                );

                if (attribute?.value?.image_manager_venture_id) {
                    logger.info('venture.getOrCreate.found', {
                        message: 'Found existing venture in mgmt-airo attributes',
                        customerId,
                        ventureId: attribute.value.image_manager_venture_id,
                    });
                    return attribute.value.image_manager_venture_id as string;
                }
            } catch (error) {
                logger.warn('venture.getOrCreate.attribute-query-failed', {
                    message: 'Failed to get venture from mgmt-airo attributes, will create new',
                    customerId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Step 2: No venture found in attributes, create a new one via GraphQL
        if (!shopperId) {
            throw new Error('Shopper ID is required to create a new venture');
        }

        logger.info('venture.getOrCreate.creating', {
            message: 'No existing venture found, creating new profile',
            customerId,
            shopperId,
        });

        const ventureId = await this.createProfileForShopper(shopperId);

        // Step 3: Store the venture ID in mgmt-airo attributes
        // Skip in local dev - attribute writes require special permissions that local dev doesn't have
        const isLocalDev = process.env.NODE_ENV === 'development';
        if (isLocalDev) {
            logger.debug('venture.getOrCreate.skip-attribute-storage', {
                message: 'Skipping mgmt-airo attribute storage in local dev',
                customerId,
                ventureId,
            });
        }
        if (this.mgmtAiroClient && !isLocalDev) {
            try {
                // Try to create the attribute
                await this.mgmtAiroClient.createAttribute(
                    'user',
                    customerId,
                    {
                        key: 'ventures',
                        value: { image_manager_venture_id: ventureId }
                    }
                );

                logger.info('venture.getOrCreate.attribute-created', {
                    message: 'Successfully stored venture ID in mgmt-airo attributes',
                    customerId,
                    ventureId,
                });
            } catch (error: any) {
                // If attribute already exists (409 conflict), try to update it
                if (error instanceof AiroHttpError && error.status === 409) {
                    try {
                        // Get the existing attribute to get its ID
                        const existingAttribute = await this.mgmtAiroClient.getAttribute(
                            'user',
                            customerId,
                            'ventures'
                        );

                        if (existingAttribute) {
                            await this.mgmtAiroClient.updateAttribute(
                                existingAttribute.id,
                                {
                                    value: { image_manager_venture_id: ventureId }
                                }
                            );

                            logger.info('venture.getOrCreate.attribute-updated', {
                                message: 'Successfully updated venture ID in mgmt-airo attributes',
                                customerId,
                                ventureId,
                            });
                        }
                    } catch (updateError) {
                        logger.error('venture.getOrCreate.attribute-update-failed', {
                            message: 'Failed to update venture in mgmt-airo attributes',
                            customerId,
                            ventureId,
                            error: updateError instanceof Error ? updateError.message : String(updateError),
                        });
                        // Don't throw - venture was created successfully, just attribute update failed
                    }
                } else {
                    logger.error('venture.getOrCreate.attribute-create-failed', {
                        message: 'Failed to store venture in mgmt-airo attributes',
                        customerId,
                        ventureId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    // Don't throw - venture was created successfully, just attribute storage failed
                }
            }
        }

        return ventureId;
    }

    /**
     * Get customer projects with billing information
     *
     * @param customerId - Customer ID (required)
     * @param after - Cursor for pagination (optional)
     * @returns Promise resolving to customer projects with pagination info
     *
     * @throws {Error} If GraphQL request fails
     */
    async getCustomerProjects(customerId: string, after?: string): Promise<CustomerProjectsResponse> {
        const query = `
      query CustomerQuery($customerId: UUID!, $after: String) {
        projects(customerId: $customerId, after: $after) {
          edges {
            node {
              group
              status
              billing {
                id
                plan
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

        try {
            const client = await this.ensureGraphQLClient();
            const response = await client.request<CustomerProjectsResponse>({
                query,
                variables: { customerId, after },
                operationName: 'CustomerQuery',
            });

            logger.info('venture.getCustomerProjects.success', {
                message: 'Successfully fetched customer projects',
                customerId,
                after,
                projectCount: response.data?.projects?.edges?.length || 0,
                hasNextPage: response.data?.projects?.pageInfo?.hasNextPage,
            });

            return response.data;
        } catch (error) {
            logger.error('venture.getCustomerProjects.failed', {
                message: 'Failed to get customer projects',
                customerId,
                after,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
