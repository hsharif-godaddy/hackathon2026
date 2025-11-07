import { readFile, access } from 'fs/promises';
import { constants } from 'fs';

export interface EnvManagerOptions {
  envFilePath: string;
}

/**
 * Utility for reading and parsing .env files
 */
export class EnvManager {
  private envFilePath: string;

  constructor(options: EnvManagerOptions) {
    this.envFilePath = options.envFilePath;
  }

  /**
   * Check if the .env file exists
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.envFilePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and parse environment variables from .env file
   * Returns a record of key-value pairs
   */
  async readEnvFile(): Promise<Record<string, string>> {
    const envVars: Record<string, string> = {};

    try {
      const content = await readFile(this.envFilePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        // Parse KEY=VALUE format
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
          continue;
        }

        const key = trimmed.substring(0, equalIndex).trim();
        let value = trimmed.substring(equalIndex + 1).trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }

        envVars[key] = value;
      }

      return envVars;
    } catch (error) {
      throw new Error(`Failed to read .env file at ${this.envFilePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
