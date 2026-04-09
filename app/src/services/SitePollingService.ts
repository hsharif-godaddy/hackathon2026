import { agentFetch } from '@/lib/agent-fetch';
import { SiteStatus } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

export interface SitePollingSnapshot {
  siteId: string;
  status: SiteStatus;
  agent_url: string | null;
  backend_url: string | null;
  preview_url: string | null;
  ready: boolean;
  registrationComplete: boolean; // Tracks if app successfully registered with agent service
  registrationAttempted: boolean; // Tracks if we've tried to register (may have failed)
  message?: string;
}

export interface CreateAppResult {
  success: boolean;
  app?: {
    id: string;
    name?: string;
    status: SiteStatus;
  };
  aiGeneratedName?: string;
  nameSuggested?: boolean;
  originalName?: string;
  error?: string;
}

export class SitePollingService {
  private maxAttempts: number = 60; // 10 minutes with 10-second intervals
  private pollInterval: number = 10000; // 10 seconds

  constructor(options?: { maxAttempts?: number; pollInterval?: number }) {
    if (options?.maxAttempts) this.maxAttempts = options.maxAttempts;
    if (options?.pollInterval) this.pollInterval = options.pollInterval;
  }

  /**
   * Poll for agent readiness and check if app exists
   */
  async pollForReadinessAndCreateApp(
    siteId: string,
    _initialPrompt: string,
    onStatusUpdate?: (status: SitePollingSnapshot, attempt: number) => void
  ): Promise<CreateAppResult> {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const poll = async () => {
        try {
          attempts++;

          // Get site data using centralized store to prevent duplicate requests
          const { useSiteStore } = await import('@/stores/useSiteStore');
          const siteStore = useSiteStore.getState();
          const site = await siteStore.fetchSite(siteId);

          if (!site) {
            return reject(new Error('Site not found'));
          }

          if (!site.agent_url) {
            // Continue polling if agent URL not set yet
            if (attempts < this.maxAttempts) {
              setTimeout(poll, this.pollInterval);
            } else {
              reject(new Error('Agent URL never became available'));
            }
            return;
          }

          // Check health of all services
          const agentHealthy = site.agent_url ?
            await this.checkUrlHealth(`${site.agent_url}/health`, 'Agent') : false;

          const frontendHealthy = site.preview_url ?
            await this.checkUrlHealth(`${site.preview_url}/airo/health`, 'Frontend') : false;

          // All services must be healthy to proceed
          const allServicesReady = agentHealthy && frontendHealthy;
          let registrationComplete = false;
          let registrationAttempted = false;
          if (allServicesReady) {
            registrationAttempted = true;
            registrationComplete = await this.checkAppExists(siteId, site.agent_url);
          }

          const siteStatus: SitePollingSnapshot = {
            siteId: site.id,
            status: site.status, // Keep existing status from database
            agent_url: site.agent_url,
            backend_url: site.backend_url,
            preview_url: site.preview_url,
            ready: allServicesReady,
            registrationComplete,
            registrationAttempted,
            message: `Agent: ${agentHealthy ? '✅' : '❌'}, Frontend: ${frontendHealthy ? '✅' : '❌'}`
          };

          // Notify caller of status update
          if (onStatusUpdate) {
            onStatusUpdate(siteStatus, attempts);
          }

          // Check if agent is ready
          if (siteStatus.ready) {
            try {
              if (registrationComplete) {
                await this.updateSiteStatus(siteId, SiteStatus.Running);
                resolve({
                  success: true,
                  app: { id: siteId, status: SiteStatus.Running }
                });
                return;
              }

              // In V2 mode, app creation is handled during site creation.
              // If we got here and services are ready but app doesn't exist,
              // the agent should auto-register on startup.
              await this.updateSiteStatus(siteId, SiteStatus.Running);
              resolve({
                success: true,
                app: { id: siteId, status: SiteStatus.Running }
              });
            } catch (createError) {
              logger.error('polling.create-app.failed', { appId: siteId, error: createError });
              await this.updateSiteStatus(siteId, SiteStatus.Failed);
              reject(createError);
            }
            return;
          }

          // Continue polling if not ready and under max attempts
          if (attempts < this.maxAttempts) {
            setTimeout(poll, this.pollInterval);
          } else {
            await this.updateSiteStatus(siteId, SiteStatus.Failed);
            reject(new Error('Services health polling timed out'));
          }

        } catch (error) {
          logger.error('polling.error', { appId: siteId, error });

          if (attempts >= this.maxAttempts) {
            await this.updateSiteStatus(siteId, SiteStatus.Failed);
            reject(error);
          } else {
            // Try again after delay
            setTimeout(poll, this.pollInterval);
          }
        }
      };

      // Start polling
      poll();
    });
  }

  /**
   * Check if a URL is healthy by making a direct request from the UI
   */
  private async checkUrlHealth(url: string, serviceName: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      // Use appropriate headers for different service types
      const headers: Record<string, string> = {
        'User-Agent': 'airo-health-checker'
      };

      // Frontend expects HTML, APIs expect JSON
      if (serviceName === 'Frontend') {
        headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      } else {
        headers['Accept'] = 'application/json';
      }

      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal,
        headers
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if app already exists for this site
   */
  private async checkAppExists(siteId: string, agentUrl: string): Promise<boolean> {
    try {
      const response = await agentFetch(`${agentUrl}/apps/${siteId}`, {
        siteId,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        return true;
      } else if (response.status === 404) {
        return false;
      } else {
        return false; // Assume doesn't exist if we can't determine
      }
    } catch {
      return false; // Assume doesn't exist if we can't check
    }
  }

  /**
   * Update site status via API
   */
  private async updateSiteStatus(siteId: string, status: SiteStatus): Promise<void> {
    try {
      const response = await appFetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });

      if (response.ok) {
        // Update the global site store cache to reflect status change in the UI
        const { useSiteStore } = await import('@/stores/useSiteStore');
        useSiteStore.getState().updateSite(siteId, { status });
      }
    } catch (error) {
      logger.warn('polling.update-site-status.failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Check site status once (no polling) - directly checks agent URL from UI
   */
  async checkSiteStatus(siteId: string): Promise<SitePollingSnapshot> {
    // Get site data using centralized store to prevent duplicate requests
    const { useSiteStore } = await import('@/stores/useSiteStore');
    const siteStore = useSiteStore.getState();
    const site = await siteStore.fetchSite(siteId);

    if (!site) {
      throw new Error(`Failed to get site status: Site not found`);
    }

    if (!site.agent_url) {
      return {
        siteId: site.id,
        status: site.status,
        agent_url: site.agent_url,
        backend_url: site.backend_url,
        preview_url: site.preview_url,
        ready: false,
        registrationComplete: false,
        registrationAttempted: false,
        message: 'Agent URL not available yet'
      };
    }

    // Check health of all services
    const agentHealthy = site.agent_url ?
      await this.checkUrlHealth(`${site.agent_url}/health`, 'Agent') : false;

    const frontendHealthy = site.preview_url ?
      await this.checkUrlHealth(`${site.preview_url}/airo/health`, 'Frontend') : false;

    const allServicesReady = agentHealthy && frontendHealthy;

    // Treat registration as complete only when agents confirms app metadata exists.
    let registrationComplete = false;
    let registrationAttempted = false;
    if (allServicesReady) {
      registrationAttempted = true;
      registrationComplete = await this.checkAppExists(siteId, site.agent_url);
    }

    // Auto-update status to "running" if services are ready
    if (site.status === SiteStatus.Created && allServicesReady && site.agent_url && site.preview_url) {
      await this.updateSiteStatus(siteId, SiteStatus.Running);
      site.status = SiteStatus.Running; // Update local object for return
    }

    return {
      siteId: site.id,
      status: site.status,
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      ready: allServicesReady,
      registrationComplete,
      registrationAttempted,
      message: `Agent: ${agentHealthy ? '✅' : '❌'}, Frontend: ${frontendHealthy ? '✅' : '❌'}`
    };
  }
}

// Export singleton instance
export const sitePollingService = new SitePollingService();
