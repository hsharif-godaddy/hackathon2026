/**
 * Prisma-based Site Service
 * Replaces the old SQL-based SiteService with type-safe Prisma operations
 */

import { PrismaClient, SiteStatus } from '@/generated/prisma';
import { v4 as uuidv4 } from 'uuid';

// Singleton Prisma client
let prisma: PrismaClient;

function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export interface CreateSiteRequest {
  account_id: string;
  initial_prompt: string;
  title?: string;
  domain?: string;
}

export interface Site {
  id: string;
  account_id: string;
  title: string;
  initial_prompt: string | null;
  domain: string | null;
  agent_url: string | null;
  backend_url: string | null;
  preview_url: string | null;
  ceph_mount_id: string | null;
  ceph_dir_number: string | null;
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
  created_at: Date;
  updated_at: Date;
}

export class PrismaSiteService {
  private client: PrismaClient;

  constructor() {
    this.client = getPrismaClient();
  }

  /**
   * Create a new site with minimal data (for quick creation)
   */
  async createSiteSimple(request: CreateSiteRequest): Promise<Site> {
    const siteId = uuidv4();
    const title = request.title || this.generateTitle(request.initial_prompt);

    const cephAssignment = await this.getNextCephAssignment();


    const site = await this.client.sites.create({
      data: {
        id: siteId,
        account_id: request.account_id,
        title,
        initial_prompt: request.initial_prompt,
        domain: request.domain,
        ceph_mount_id: cephAssignment.cephMountId,
        ceph_dir_number: cephAssignment.cephDirNumber,
        status: SiteStatus.init, // Default status for new sites
      },
    });

    return this.mapSiteFromPrisma(site);
  }

  /**
   * Get a site by ID
   */
  async getSiteById(siteId: string): Promise<Site | null> {
    const site = await this.client.sites.findUnique({
      where: { id: siteId },
    });

    return site ? this.mapSiteFromPrisma(site) : null;
  }

  /**
   * Get all sites for an account
   */
  async getSitesByAccountId(accountId: string): Promise<Site[]> {
    const sites = await this.client.sites.findMany({
      where: { account_id: accountId },
      orderBy: { created_at: 'desc' },
    });

    return sites.map(site => this.mapSiteFromPrisma(site));
  }

  /**
   * Update a site
   */
  async updateSite(siteId: string, updates: Partial<Omit<Site, 'id' | 'created_at' | 'updated_at'>>): Promise<Site | null> {
    try {
      const site = await this.client.sites.update({
        where: { id: siteId },
        data: {
          ...updates,
          updated_at: new Date(),
        },
      });

      return this.mapSiteFromPrisma(site);
    } catch (error) {
      // Handle case where site doesn't exist
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a site
   */
  async deleteSite(siteId: string): Promise<boolean> {
    try {
      await this.client.sites.delete({
        where: { id: siteId },
      });
      return true;
    } catch (error) {
      // Handle case where site doesn't exist
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get next available Ceph storage assignment
   * this is temp code until we have a proper Ceph storage assignment system
   * we will want to store the mounts per cell in the database and have a proper round robin system
   */
  private async getNextCephAssignment(): Promise<{ cephMountId: string; cephDirNumber: string }> {
    // Available Ceph mounts (hardcoded for now, could be configurable)
    const cephMounts = [
      'ac214cd3-b745-47a2-921c-61b4419679fe',
      'a2a8a675-dcb4-40ec-a719-27854cc0956c'
    ];

    // Randomly select a mount
    const selectedMount = cephMounts[Math.floor(Math.random() * cephMounts.length)];

    // Randomly select a directory number from 00 to 99
    const randomDirNumber = Math.floor(Math.random() * 100);

    return {
      cephMountId: selectedMount,
      cephDirNumber: randomDirNumber.toString().padStart(2, '0')
    };
  }

  /**
   * Generate a title from the initial prompt
   */
  private generateTitle(prompt: string): string {
    if (!prompt || prompt.trim().length === 0) {
      return 'Untitled Project';
    }

    // Take first 50 characters and clean it up
    let title = prompt.trim().substring(0, 50);

    // Remove newlines and extra spaces
    title = title.replace(/\s+/g, ' ').trim();

    // Add ellipsis if truncated
    if (prompt.length > 50) {
      title += '...';
    }

    return title;
  }

  /**
   * Map Prisma site object to our Site interface
   */
  private mapSiteFromPrisma(prismaSite: any): Site {
    return {
      id: prismaSite.id,
      account_id: prismaSite.account_id,
      title: prismaSite.title || 'Untitled Project',
      initial_prompt: prismaSite.initial_prompt,
      domain: prismaSite.domain,
      agent_url: prismaSite.agent_url,
      backend_url: prismaSite.backend_url,
      preview_url: prismaSite.preview_url,
      ceph_mount_id: prismaSite.ceph_mount_id,
      ceph_dir_number: prismaSite.ceph_dir_number,
      status: prismaSite.status,
      created_at: prismaSite.created_at,
      updated_at: prismaSite.updated_at,
    };
  }

  /**
   * Close the Prisma connection (useful for testing)
   */
  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }
}

// Export a default instance for convenience
export const prismaSiteService = new PrismaSiteService();
