import { Logger } from '../logging/index.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';

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
 * Uses secrets/src/secrets-utils.ts listSecretNames() function
 * via Node.js --experimental-strip-types flag to import TypeScript directly.
 */
export class SecretsManagementTool {
  private logger: Logger;
  private readonly tasks: WorkspaceTasks | null;

  constructor(tasks?: WorkspaceTasks) {
    this.logger = Logger.create({ component: 'secrets-management-tool' });
    this.tasks = tasks || null;
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
      if (!this.tasks) {
        return {
          success: false,
          secretNames: [],
          count: 0,
          error: 'Workspace tasks not available. The app container may not be running or the socket is not accessible.'
        };
      }

      const execResult = await this.tasks.runCommandSync({
        command: `node --experimental-strip-types -e "import('/app/airo-secrets/src/secrets-utils.ts').then(module => module.listSecretNames()).then(data => console.log(JSON.stringify(data))).catch(err => { console.error(err.message); process.exit(1); })"`,
        workingDir: '/app',
        timeoutSeconds: 10,
      });

      if (execResult.exitCode !== 0) {
        this.logger.error('secrets.list.failure', {
          appId,
          exitCode: execResult.exitCode,
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
