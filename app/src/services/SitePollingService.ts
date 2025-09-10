import { appFetch } from '@/lib/gasket-config';

export interface SiteStatus {
  siteId: string;
  status: 'init' | 'creating' | 'created' | 'running' | 'failed' | 'stopped';
  agent_url: string | null;
  backend_url: string | null;
  preview_url: string | null;
  ready: boolean;
  message?: string;
}

export interface CreateAppResult {
  success: boolean;
  app?: {
    id: string;
    name?: string;
    status: string;
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
   * Poll for agent readiness by directly checking agent URL and then create the app
   */
  async pollForReadinessAndCreateApp(
    siteId: string,
    initialPrompt: string,
    onStatusUpdate?: (status: SiteStatus, attempt: number) => void
  ): Promise<CreateAppResult> {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const poll = async () => {
        try {
          attempts++;
          console.log(`🔄 Polling services health (${attempts}/${this.maxAttempts}):`, siteId);

          // Get site data from database to get URLs
          const siteResponse = await appFetch(`/api/sites/${siteId}`);

          if (!siteResponse.ok) {
            if (siteResponse.status === 404) {
              return reject(new Error('Site not found'));
            }
            throw new Error(`HTTP ${siteResponse.status}: ${siteResponse.statusText}`);
          }

          const site = await siteResponse.json();

          if (!site.agent_url) {
            console.log('🔄 Agent URL not available yet:', { agent_url: site.agent_url });

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
            await this.checkUrlHealth(`${site.preview_url}`, 'Frontend') : false;

          // All services must be healthy to proceed
          const allServicesReady = agentHealthy && frontendHealthy;

          const siteStatus: SiteStatus = {
            siteId: site.id,
            status: site.status, // Keep existing status from database
            agent_url: site.agent_url,
            backend_url: site.backend_url,
            preview_url: site.preview_url,
            ready: allServicesReady,
            message: `Agent: ${agentHealthy ? '✅' : '❌'}, Frontend: ${frontendHealthy ? '✅' : '❌'}`
          };

          console.log('🐛 DEBUG: All services health check:', {
            siteId,
            agentHealthy,
            frontendHealthy,
            ready: siteStatus.ready,
            message: siteStatus.message
          });

          // Notify caller of status update
          if (onStatusUpdate) {
            onStatusUpdate(siteStatus, attempts);
          }

          // Check if agent is ready
          if (siteStatus.ready) {
            console.log('✅ All services are healthy! Creating app...', siteId);

            try {
              // Check if app already exists to avoid duplicates
              const appExists = await this.checkAppExists(siteId, site.agent_url);

              if (appExists) {
                console.log('✅ App already exists for site:', siteId);
                await this.updateSiteStatus(siteId, 'running');
                resolve({
                  success: true,
                  app: { id: siteId, status: 'running' }
                });
                return;
              }

              // Create app via agent API
              const createAppResult = await this.createAppViaAgent(siteId, initialPrompt, site.agent_url);

              if (createAppResult.success) {
                // Update site status to running
                await this.updateSiteStatus(siteId, 'running');
                resolve(createAppResult);
              } else {
                reject(new Error(createAppResult.error || 'Failed to create app'));
              }
            } catch (createError) {
              console.error('❌ Failed to create app:', createError);
              await this.updateSiteStatus(siteId, 'failed');
              reject(createError);
            }
            return;
          }

          // Continue polling if not ready and under max attempts
          if (attempts < this.maxAttempts) {
            setTimeout(poll, this.pollInterval);
          } else {
            console.log('⏰ Services health polling timed out:', siteId);
            await this.updateSiteStatus(siteId, 'failed');
            reject(new Error('Services health polling timed out'));
          }

        } catch (error) {
          console.error('❌ Error polling services health:', error);

          if (attempts >= this.maxAttempts) {
            await this.updateSiteStatus(siteId, 'failed');
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
      console.log(`🔍 Checking ${serviceName} health:`, url);

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

      const isHealthy = response.ok;
      console.log(`${isHealthy ? '✅' : '❌'} ${serviceName} health check:`, {
        url,
        status: response.status,
        healthy: isHealthy
      });

      return isHealthy;

    } catch (error) {
      console.log(`❌ ${serviceName} health check failed:`, {
        url,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if app already exists for this site
   */
  private async checkAppExists(siteId: string, agentUrl: string): Promise<boolean> {
    try {
      console.log('🔍 Checking if app already exists for site:', siteId);

      const response = await fetch(`${agentUrl}/apps/${siteId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ App exists:', data);
        return true;
      } else if (response.status === 404) {
        console.log('ℹ️ App does not exist yet for site:', siteId);
        return false;
      } else {
        console.warn('⚠️ Unexpected response when checking app existence:', response.status);
        return false; // Assume doesn't exist if we can't determine
      }
    } catch (error) {
      console.warn('⚠️ Error checking if app exists:', error);
      return false; // Assume doesn't exist if we can't check
    }
  }

  /**
   * Generate app name from initial prompt or fallback to site ID
   */
  private generateAppName(initialPrompt?: string, siteId?: string): string {
    if (initialPrompt && initialPrompt.trim()) {
      // Take first 3-5 words from prompt and clean them up
      const words = initialPrompt.trim()
        .split(/\s+/)
        .slice(0, 4)
        .map(word => word.replace(/[^\w]/g, ''))
        .filter(word => word.length > 0);

      if (words.length > 0) {
        return words.join(' ');
      }
    }

    // Fallback to a generic name with site ID
    return siteId ? `App ${siteId.slice(0, 8)}` : 'New App';
  }

  /**
   * Create app via agent API
   */
  private async createAppViaAgent(
    siteId: string,
    initialPrompt: string,
    agentUrl: string
  ): Promise<CreateAppResult> {
    try {
      console.log('🤖 Creating app via local API:', { siteId });

      // Call our local app creation API instead of agents service
      const response = await appFetch('/api/apps/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          siteId: siteId,
          name: this.generateAppName(initialPrompt, siteId),
          initialPrompt: initialPrompt || undefined
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`App creation API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ App created via local API:', data);

      return {
        success: true,
        app: data.app,
        aiGeneratedName: data.aiGeneratedName,
        nameSuggested: data.nameSuggested,
        originalName: data.originalName
      };

    } catch (error) {
      console.error('❌ Failed to create app via agent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update site status via API
   */
  private async updateSiteStatus(siteId: string, status: string): Promise<void> {
    try {
      const response = await appFetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        console.warn('⚠️ Failed to update site status:', response.statusText);
      } else {
        console.log(`✅ Site status updated to: ${status}`);
      }
    } catch (error) {
      console.warn('⚠️ Error updating site status:', error);
    }
  }

  /**
   * Check site status once (no polling) - directly checks agent URL from UI
   */
  async checkSiteStatus(siteId: string): Promise<SiteStatus> {
    // Get site data from database
    const siteResponse = await appFetch(`/api/sites/${siteId}`);

    if (!siteResponse.ok) {
      throw new Error(`HTTP ${siteResponse.status}: ${siteResponse.statusText}`);
    }

    const site = await siteResponse.json();

    if (!site.agent_url) {
      return {
        siteId: site.id,
        status: site.status, // Keep existing status from database
        agent_url: site.agent_url,
        backend_url: site.backend_url,
        preview_url: site.preview_url,
        ready: false,
        message: 'Agent URL not available yet'
      };
    }

    // Check health of all services
    const agentHealthy = site.agent_url ?
      await this.checkUrlHealth(`${site.agent_url}/health`, 'Agent') : false;

    const frontendHealthy = site.preview_url ?
      await this.checkUrlHealth(`${site.preview_url}`, 'Frontend') : false;

    const allServicesReady = agentHealthy && frontendHealthy;

    // Auto-update status from "created" to "running" if services are ready
    if (site.status === 'created' && allServicesReady && site.agent_url && site.preview_url) {
      console.log('🎉 Both services are healthy! Updating status to running:', {
        siteId: site.id,
        agentUrl: site.agent_url,
        previewUrl: site.preview_url,
        agentHealthy,
        frontendHealthy
      });

      // Register app with agent service before updating status
      try {
        console.log('📝 Registering app with agent service:', siteId);
        const registerResponse = await appFetch(`${site.agent_url}/apps/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: site.id,
            name: site.title || `App ${site.id}`,
            initialPrompt: site.initial_prompt
          })
        });

        if (registerResponse.ok) {
          const registerData = await registerResponse.json();
          console.log('✅ App registered successfully:', registerData.message);
        } else {
          console.warn('⚠️ App registration failed, but continuing:', registerResponse.status);
        }
      } catch (error) {
        console.warn('⚠️ App registration error, but continuing:', error);
      }

      await this.updateSiteStatus(siteId, 'running');
      site.status = 'running'; // Update local object for return
    }

    return {
      siteId: site.id,
      status: site.status, // Will now be 'running' if updated above
      agent_url: site.agent_url,
      backend_url: site.backend_url,
      preview_url: site.preview_url,
      ready: allServicesReady,
      message: `Agent: ${agentHealthy ? '✅' : '❌'}, Frontend: ${frontendHealthy ? '✅' : '❌'}`
    };
  }
}

// Export singleton instance
export const sitePollingService = new SitePollingService();
