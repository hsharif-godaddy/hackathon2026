/**
 * Venture Management Service
 *
 * Handles fetching and creating venture profiles via GraphQL API.
 */

import { createGraphQLClientWithS2SAuth, GraphQLClient } from './product-graph/client';
import { logger } from '@/lib/request-context';

export interface Venture {
    id: string;
    profile?: {
        id: string;
        name?: string;
        logoUrl?: string;
    };
}

export interface VentureNode {
    id: string;
    profile?: {
        id: string;
        name?: string;
        logoUrl?: string;
    };
}

export interface LatestVentureResponse {
    latestShopperVenture?: Venture;
    latestCustomerVenture?: Venture;
}

export interface VentureNodeResponse {
    ventureNode?: VentureNode;
}

export interface Profile {
    id: string;
    name?: string;
    logoUrl?: string;
}

export interface CreateProfileResponse {
    findOrCreateProfileForShopper?: Profile;
    createProfileForShopper?: Profile;
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
            const response = await client.request<LatestVentureResponse>({
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
     * Get latest venture for a customer
     *
     * @param customerId - Customer ID (UUID)
     * @returns Promise resolving to venture ID or null if not found
     *
     * @throws {Error} If GraphQL request fails
     */
    async getLatestCustomerVenture(customerId: string): Promise<string | null> {
        const query = `
      query GetLatestCustomerVenture($customerId: UUID!) {
        latestCustomerVenture(customerId: $customerId) {
          id
          profile {
            id
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<LatestVentureResponse>({
                query,
                variables: { customerId },
                operationName: 'GetLatestCustomerVenture',
            });

            const ventureId = response.data?.latestCustomerVenture?.id;
            return ventureId || null;
        } catch (error) {
            logger.error('venture.getLatestCustomerVenture.failed', {
                message: 'Failed to get latest customer venture',
                customerId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get venture by ID or domain name
     *
     * @param customerId - Customer ID (UUID)
     * @param ventureId - Optional venture ID
     * @param domainName - Optional domain name
     * @returns Promise resolving to venture ID or null if not found
     *
     * @throws {Error} If GraphQL request fails
     */
    async getVentureNode(
        customerId: string,
        ventureId?: string,
        domainName?: string
    ): Promise<string | null> {
        const query = `
      query GetVentureNode($customerId: UUID!, $ventureId: UUID, $domainName: String) {
        ventureNode(customerId: $customerId, ventureId: $ventureId, domainName: $domainName) {
          id
          profile {
            id
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<VentureNodeResponse>({
                query,
                variables: { customerId, ventureId, domainName },
                operationName: 'GetVentureNode',
            });

            const ventureNodeId = response.data?.ventureNode?.id;
            return ventureNodeId || null;
        } catch (error) {
            logger.error('venture.getVentureNode.failed', {
                message: 'Failed to get venture node',
                customerId,
                ventureId,
                domainName,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Find or create a profile for a shopper
     *
     * @param shopperId - Shopper ID
     * @param projectedProject - Projected project input for profile creation
     * @param projectedProject.group - Project group (e.g., 'vnext')
     * @param projectedProject.domain - Optional domain name
     * @param projectedProject.ventureId - Optional venture ID
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If mutation fails or venture ID cannot be retrieved
     */
    async findOrCreateProfileForShopper(
        shopperId: string,
        projectedProject: {
            group: string;
            domain?: string;
            ventureId?: string;
        }
    ): Promise<string> {
        const mutation = `
      mutation FindOrCreateProfileForShopper($shopperId: String!, $projectedProject: ProjectedProjectInput!) {
        findOrCreateProfileForShopper(shopperId: $shopperId, projectedProject: $projectedProject) {
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
                findOrCreateProfileForShopper?: {
                    id: string;
                    venture?: { id: string };
                };
            }>({
                query: mutation,
                variables: {
                    shopperId,
                    projectedProject,
                },
                operationName: 'FindOrCreateProfileForShopper',
            });

            const ventureId =
                response.data?.findOrCreateProfileForShopper?.venture?.id;

            if (!ventureId) {
                throw new Error('Failed to get venture ID from created profile');
            }

            logger.info('venture.findOrCreateProfile.success', {
                message: 'Successfully found or created profile',
                shopperId,
                ventureId,
            });

            return ventureId;
        } catch (error) {
            logger.error('venture.findOrCreateProfile.failed', {
                message: 'Failed to find or create profile for shopper',
                shopperId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get ventures for a shopper filtered by project group
     *
     * @param shopperId - Shopper ID
     * @param projectGroup - Project group to filter by (e.g., 'vnext', 'wordpress', 'domain')
     * @returns Promise resolving to array of venture IDs with matching project group
     *
     * @throws {Error} If GraphQL request fails
     */
    async getShopperVenturesByProjectGroup(
        shopperId: string,
        projectGroup: string
    ): Promise<string[]> {
        const query = `
      query GetShopperVenturesByProjectGroup($shopperId: String!) {
        shopperVentures(shopperId: $shopperId) {
          id
          projects {
            id
            group
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<{
                shopperVentures?: Array<{
                    id: string;
                    projects?: Array<{
                        id: string;
                        group: string;
                    }>;
                }>;
            }>({
                query,
                variables: { shopperId },
                operationName: 'GetShopperVenturesByProjectGroup',
            });

            // Filter ventures that have at least one project with the matching group
            const ventures = response.data?.shopperVentures || [];
            const ventureIds = ventures
                .filter((venture) =>
                    venture.projects?.some((project) => project.group === projectGroup)
                )
                .map((venture) => venture.id);

            logger.info('venture.getShopperByProjectGroup.success', {
                message: 'Successfully fetched shopper ventures by project group',
                shopperId,
                projectGroup,
                foundCount: ventureIds.length,
            });

            return ventureIds;
        } catch (error) {
            logger.error('venture.getShopperByProjectGroup.failed', {
                message: 'Failed to get shopper ventures by project group',
                shopperId,
                projectGroup,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get ventures for a customer filtered by project group
     *
     * @param customerId - Customer ID (UUID)
     * @param projectGroup - Project group to filter by (e.g., 'vnext', 'wordpress', 'domain')
     * @param limit - Maximum number of ventures to return (default: 10)
     * @returns Promise resolving to array of venture IDs with matching project group
     *
     * @throws {Error} If GraphQL request fails
     */
    async getVenturesByProjectGroup(
        customerId: string,
        projectGroup: string,
        limit: number = 10
    ): Promise<string[]> {
        const query = `
      query GetVenturesByProjectGroup($customerId: UUID!, $first: Int!) {
        ventures(customerId: $customerId, first: $first) {
          edges {
            node {
              id
              projects(first: 50) {
                edges {
                  node {
                    id
                    group
                  }
                }
              }
            }
          }
        }
      }
    `;

        try {
            const client = await this.ensureClient();
            const response = await client.request<{
                ventures?: {
                    edges?: Array<{
                        node?: {
                            id: string;
                            projects?: {
                                edges?: Array<{
                                    node?: {
                                        id: string;
                                        group: string;
                                    };
                                }>;
                            };
                        };
                    }>;
                };
            }>({
                query,
                variables: { customerId, first: limit },
                operationName: 'GetVenturesByProjectGroup',
            });

            // Filter ventures that have at least one project with the matching group
            const ventureIds: string[] = [];
            const edges = response.data?.ventures?.edges || [];

            for (const edge of edges) {
                const venture = edge.node;
                if (!venture) continue;

                const projectEdges = venture.projects?.edges || [];
                const hasMatchingProject = projectEdges.some(
                    (projectEdge) => projectEdge.node?.group === projectGroup
                );

                if (hasMatchingProject) {
                    ventureIds.push(venture.id);
                }
            }

            logger.info('venture.getByProjectGroup.success', {
                message: 'Successfully fetched ventures by project group',
                customerId,
                projectGroup,
                foundCount: ventureIds.length,
            });

            return ventureIds;
        } catch (error) {
            logger.error('venture.getByProjectGroup.failed', {
                message: 'Failed to get ventures by project group',
                customerId,
                projectGroup,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get first venture with a specific project group, or create one if none exists
     * Uses shopper ID for query (simpler and more direct)
     *
     * @param shopperId - Shopper ID
     * @param projectGroup - Project group to find (e.g., 'vnext', 'wordpress')
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If query fails
     */
    async getOrCreateVentureByProjectGroup(
        shopperId: string,
        projectGroup: string
    ): Promise<string> {
        try {
            // Try to find existing venture with this project group using shopper ID
            const ventureIds = await this.getShopperVenturesByProjectGroup(shopperId, projectGroup);

            if (ventureIds.length > 0) {
                logger.info('venture.getOrCreateByGroup.found', {
                    message: 'Found existing venture with project group',
                    shopperId,
                    projectGroup,
                    ventureId: ventureIds[0],
                });
                return ventureIds[0];
            }
        } catch (error) {
            logger.warn('venture.getOrCreateByGroup.query-failed', {
                message: 'Failed to query ventures by project group, will create new',
                shopperId,
                projectGroup,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // No venture found with this project group, create a new profile
        logger.info('venture.getOrCreateByGroup.creating', {
            message: 'No venture found with project group, creating new profile',
            shopperId,
            projectGroup,
        });

        const ventureId = await this.findOrCreateProfileForShopper(shopperId, {
            group: projectGroup,
        });

        return ventureId;
    }

    /**
     * Get first venture with a specific project group by customer ID, or create one if none exists
     * Uses customer ID for paginated query
     *
     * @param shopperId - Shopper ID (for creation fallback)
     * @param customerId - Customer ID (UUID)
     * @param projectGroup - Project group to find (e.g., 'vnext', 'wordpress')
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If query fails
     */
    async getOrCreateVentureByProjectGroupAndCustomer(
        shopperId: string,
        customerId: string,
        projectGroup: string
    ): Promise<string> {
        try {
            // Try to find existing venture with this project group
            const ventureIds = await this.getVenturesByProjectGroup(customerId, projectGroup, 1);

            if (ventureIds.length > 0) {
                logger.info('venture.getOrCreateByGroupCustomer.found', {
                    message: 'Found existing venture with project group',
                    customerId,
                    projectGroup,
                    ventureId: ventureIds[0],
                });
                return ventureIds[0];
            }
        } catch (error) {
            logger.warn('venture.getOrCreateByGroupCustomer.query-failed', {
                message: 'Failed to query ventures by project group, will create new',
                customerId,
                projectGroup,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // No venture found with this project group, create a new profile
        logger.info('venture.getOrCreateByGroupCustomer.creating', {
            message: 'No venture found with project group, creating new profile',
            shopperId,
            customerId,
            projectGroup,
        });

        const ventureId = await this.findOrCreateProfileForShopper(shopperId, {
            group: projectGroup,
        });

        return ventureId;
    }

    /**
     * Get or create venture ID for a user
     *
     * Tries multiple strategies:
     * 1. Get latest shopper venture
     * 2. Get latest customer venture
     * 3. Create new profile if none exists
     *
     * @param shopperId - Shopper ID
     * @param customerId - Optional customer ID (UUID)
     * @param projectGroup - Optional project group for new ventures (default: 'vnext')
     * @returns Promise resolving to venture ID
     *
     * @throws {Error} If all strategies fail
     */
    async getOrCreateVentureId(
        shopperId: string,
        customerId?: string,
        projectGroup: string = 'vnext'
    ): Promise<string> {
        // Try to get existing venture by shopper ID first
        try {
            const ventureId = await this.getLatestShopperVenture(shopperId);
            if (ventureId) {
                logger.info('venture.getOrCreate.found', {
                    message: 'Found existing venture for shopper',
                    shopperId,
                    ventureId,
                });
                return ventureId;
            }
        } catch (error) {
            logger.warn('venture.getOrCreate.shopperVenture.failed', {
                message: 'Failed to get shopper venture, trying customer venture',
                shopperId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Try customer venture if customerId is provided
        if (customerId && shopperId !== customerId) {
            try {
                const ventureId = await this.getLatestCustomerVenture(customerId);
                if (ventureId) {
                    logger.info('venture.getOrCreate.found', {
                        message: 'Found existing venture for customer',
                        customerId,
                        ventureId,
                    });
                    return ventureId;
                }
            } catch (error) {
                logger.warn('venture.getOrCreate.customerVenture.failed', {
                    message: 'Failed to get customer venture, will create new profile',
                    customerId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // No existing venture found, create a new profile
        logger.info('venture.getOrCreate.creating', {
            message: 'No existing venture found, creating new profile',
            shopperId,
            customerId,
        });

        const ventureId = await this.findOrCreateProfileForShopper(shopperId, {
            group: projectGroup,
        });

        return ventureId;
    }
}
