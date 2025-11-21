import { Logger } from '../logging/index.js';
import { DevSupervisorClient } from '../services/DevSupervisorClient.js';

/**
 * Result from listing secret names
 */
export interface ListSecretNamesResult {
  success: boolean;
  secretNames: string[];
  count: number;
  message?: string;
  error?: string;
}

/**
 * Secrets Management Tool
 *
 * Provides access to non-system-managed secrets in the app container.
 * Returns only secret names, never values, for security.
 *
 * Uses dev-tools/src/secrets-utils.ts listSecretNames() function
 * via Node.js --experimental-strip-types flag to import TypeScript directly.
 */
export class SecretsManagementTool {
  private logger: Logger;
  private devSupervisor: DevSupervisorClient | null;

  constructor(devSupervisor?: DevSupervisorClient) {
    this.logger = Logger.create({ service: 'secrets-management-tool' });
    this.devSupervisor = devSupervisor || null;
  }

  /**
   * List all non-system-managed secret names
   *
   * Reads from /alloc/config.json inside the container using dev-supervisor.
   *
   * @param appId - Application ID
   * @returns Result with list of secret names
   */
  async listSecretNames(appId: string): Promise<ListSecretNamesResult> {
    this.logger.info('secrets.list.begin', { appId });

    try {
      // Check if dev-supervisor is available
      if (!this.devSupervisor?.isAvailable()) {
        return {
          success: false,
          secretNames: [],
          count: 0,
          error: 'Dev-supervisor is not available. The app container may not be running or the socket is not accessible.'
        };
      }

      // Execute command in container to list secrets using dev-tools
      // Use Node.js --experimental-strip-types to import TypeScript directly
      const execResult = await this.devSupervisor!.exec({
        command: `node --experimental-strip-types -e "import('/app/dev-tools/src/secrets-utils.ts').then(module => module.listSecretNames()).then(data => console.log(JSON.stringify(data))).catch(err => { console.error(err.message); process.exit(1); })"`,
        working_dir: '/app',
        timeout: 10,
        capture_output: true
      });

      if (execResult.exit_code !== 0) {
        this.logger.error('secrets.list.failure', {
          appId,
          exitCode: execResult.exit_code,
          stderr: execResult.stderr
        });

        return {
          success: false,
          secretNames: [],
          count: 0,
          error: `Failed to list secrets: ${execResult.stderr || execResult.stdout || 'Unknown error'}`
        };
      }

      // Parse the JSON output
      const secretNames = JSON.parse(execResult.stdout.trim());

      this.logger.info('secrets.list.success', {
        appId,
        count: secretNames.length
      });

      return {
        success: true,
        secretNames,
        count: secretNames.length,
        message: `Found ${secretNames.length} non-system-managed secret(s)`
      };
    } catch (error) {
      this.logger.error('secrets.list.error', {
        appId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        secretNames: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Failed to read secrets configuration'
      };
    }
  }
}
