import DatabaseManager from './connection';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../request-context';

export interface Site {
  id: string;
  account_id: string;
  title?: string;  // Optional - will be set by agent using AI
  initial_prompt?: string;
  domain?: string;
  agent_url?: string;
  backend_url?: string;
  preview_url?: string;
  ceph_mount_id?: string;
  ceph_dir_number?: string;
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped' | 'error';
  created_at: string;
  updated_at: string;
}

export interface CreateSiteRequest {
  account_id: string;
  title?: string;  // Optional - will be set by agent
  initial_prompt?: string;
  domain?: string;
}

export interface UpdateSiteRequest {
  title?: string;  // Can be updated by agent when AI generates it
  agent_url?: string;
  backend_url?: string;
  preview_url?: string;
  initial_prompt?: string;
  ceph_mount_id?: string;
  ceph_dir_number?: string;
  status?: 'init' | 'creating' | 'created' | 'running' | 'stopped' | 'error' | 'failed';
  domain?: string;
}

export class SiteService {
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  /**
   * Create a new site with Ceph storage (production mode)
   */
  async createSite(data: CreateSiteRequest): Promise<Site> {
    const id = uuidv4();

    // Assign Ceph storage
    logger.info('🗄️ Assigning Ceph storage...');
    const cephAssignment = await this.getNextCephAssignment();
    logger.info(`📂 Assigned Ceph: ${cephAssignment.cephMountId}/${cephAssignment.cephDirNumber}`);

    // SAFETY: Provide temporary title as fallback for databases with NOT NULL constraint
    const safeTitle = data.title || 'Untitled Project';

    await this.db.run(
      `INSERT INTO sites (id, account_id, title, initial_prompt, domain, ceph_mount_id, ceph_dir_number, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.account_id, safeTitle, data.initial_prompt || null, data.domain || null, cephAssignment.cephMountId, cephAssignment.cephDirNumber, 'init']
    );

    const site = await this.getSiteById(id);
    return site!;
  }

  /**
   * Create a new site without Ceph storage (development mode)
   */
  async createSiteSimple(data: CreateSiteRequest): Promise<Site> {
    const id = uuidv4();

    logger.info('🔧 Creating simple site record (development mode)');

    // SAFETY: Provide temporary title as fallback for databases with NOT NULL constraint
    const safeTitle = data.title || 'Untitled Project';

    await this.db.run(
      `INSERT INTO sites (id, account_id, title, initial_prompt, domain, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.account_id, safeTitle, data.initial_prompt || null, data.domain || null, 'stopped']
    );

    const site = await this.getSiteById(id);
    return site!;
  }

  /**
   * Get site by ID
   */
  async getSiteById(id: string): Promise<Site | null> {
    const result = await this.db.get<Site>(
      'SELECT * FROM sites WHERE id = ?',
      [id]
    );
    return result || null;
  }

  /**
   * Get all sites for an account
   */
  async getSitesByAccountId(accountId: string): Promise<Site[]> {
    return await this.db.all<Site>(
      'SELECT * FROM sites WHERE account_id = ? ORDER BY created_at DESC',
      [accountId]
    );
  }

  /**
   * Get site count for an account (for plan limits)
   */
  async getSiteCountByAccountId(accountId: string): Promise<number> {
    const result = await this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM sites WHERE account_id = ?',
      [accountId]
    );
    return result?.count || 0;
  }

  /**
   * Update site details
   */
  async updateSite(id: string, data: UpdateSiteRequest): Promise<Site | null> {
    const updateFields: string[] = [];
    const updateValues: (string | number | null)[] = [];

    if (data.title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(data.title);
    }

    if (data.agent_url !== undefined) {
      updateFields.push('agent_url = ?');
      updateValues.push(data.agent_url);
    }

    if (data.backend_url !== undefined) {
      updateFields.push('backend_url = ?');
      updateValues.push(data.backend_url);
    }

    if (data.preview_url !== undefined) {
      updateFields.push('preview_url = ?');
      updateValues.push(data.preview_url);
    }

    if (data.initial_prompt !== undefined) {
      updateFields.push('initial_prompt = ?');
      updateValues.push(data.initial_prompt);
    }

    if (data.status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(data.status);
    }

    if (data.domain !== undefined) {
      updateFields.push('domain = ?');
      updateValues.push(data.domain);
    }

    if (data.ceph_mount_id !== undefined) {
      updateFields.push('ceph_mount_id = ?');
      updateValues.push(data.ceph_mount_id);
    }

    if (data.ceph_dir_number !== undefined) {
      updateFields.push('ceph_dir_number = ?');
      updateValues.push(data.ceph_dir_number);
    }

    if (updateFields.length === 0) {
      return await this.getSiteById(id);
    }

    updateValues.push(id);

    await this.db.run(
      `UPDATE sites SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    return await this.getSiteById(id);
  }

  /**
   * Delete a site
   */
  async deleteSite(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM sites WHERE id = ?', [id]);
    return result.changes > 0;
  }



  /**
   * Check if account has reached site limit
   */
  async checkSiteLimit(accountId: string): Promise<{ canCreate: boolean; currentCount: number; limit: number }> {
    // In development mode, bypass site limits
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
      const currentCount = await this.getSiteCountByAccountId(accountId);
      return {
        canCreate: true, // Always allow in dev mode
        currentCount,
        limit: 999999 // High limit for dev
      };
    }

    // Get account with plan info
    const account = await this.db.get<{
      id: string;
      plan_id: string;
      site_limit: number;
    }>(
      `SELECT a.id, a.plan_id, p.site_limit
       FROM accounts a
       JOIN plans p ON a.plan_id = p.id
       WHERE a.id = ?`,
      [accountId]
    );

    if (!account) {
      return { canCreate: false, currentCount: 0, limit: 0 };
    }

    const currentCount = await this.getSiteCountByAccountId(accountId);
    const canCreate = currentCount < account.site_limit;

    return {
      canCreate,
      currentCount,
      limit: account.site_limit
    };
  }

  /**
   * Get all sites (admin function)
   */
  async getAllSites(): Promise<Site[]> {
    return await this.db.all<Site>('SELECT * FROM sites ORDER BY created_at DESC');
  }

  /**
   * Delete all sites (dev mode only)
   */
  async deleteAllSites(): Promise<number> {
    // In development mode, allow mass deletion
    const isDev = process.env.NODE_ENV === 'development';

    if (!isDev) {
      logger.warn('⚠️ deleteAllSites() is only allowed in development mode');
      return 0;
    }

    logger.info('🗑️ [DEV MODE] Deleting all sites from database...');
    const result = await this.db.run('DELETE FROM sites');
    logger.info(`✅ [DEV MODE] Deleted ${result.changes} sites`);

    return result.changes;
  }

  /**
   * Get next available Ceph storage assignment
   */
  async getNextCephAssignment(): Promise<{ cephMountId: string; cephDirNumber: string }> {
    // Available Ceph mounts (hardcoded for now, could be configurable)
    const cephMounts = [
      'ac214cd3-b745-47a2-921c-61b4419679fe',
      'a2a8a675-dcb4-40ec-a719-27854cc0956c'
    ];

    // Find the last assigned directory for each mount
    const mountAssignments: { [key: string]: number } = {};

    for (const mountId of cephMounts) {
      const result = await this.db.get<{ ceph_dir_number: string }>(
        `SELECT ceph_dir_number
         FROM sites
         WHERE ceph_mount_id = ? AND ceph_dir_number IS NOT NULL
         ORDER BY CAST(ceph_dir_number AS INTEGER) DESC
         LIMIT 1`,
        [mountId]
      );

      mountAssignments[mountId] = result ? parseInt(result.ceph_dir_number) : -1;
    }

    // Find the mount with the lowest next available directory
    let selectedMount = cephMounts[0];
    let minNextDir = mountAssignments[selectedMount] + 1;

    for (const mountId of cephMounts) {
      const nextDir = mountAssignments[mountId] + 1;
      if (nextDir < minNextDir) {
        selectedMount = mountId;
        minNextDir = nextDir;
      }
    }

    // Check if we've exceeded capacity (0-99 = 100 slots per mount)
    if (minNextDir > 99) {
      throw new Error('All Ceph storage slots are full. Maximum capacity reached.');
    }

    return {
      cephMountId: selectedMount,
      cephDirNumber: minNextDir.toString().padStart(2, '0')
    };
  }
}
