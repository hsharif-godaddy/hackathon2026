import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';

export interface EnvVariable {
  key: string;
  value: string;
}

export interface EnvManagerOptions {
  /** Path to the .env file */
  envFilePath: string;
}

export interface EnvUpdateResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Variables that were added */
  added?: string[];
  /** Variables that were updated */
  updated?: string[];
  /** Variables that were removed */
  removed?: string[];
  /** Error message if operation failed */
  error?: string;
  /** Path to the .env file that was modified */
  filePath?: string;
}

/**
 * Environment Variable Management Class
 * Handles reading, writing, and manipulating .env files safely
 */
export class EnvManager {
  private envFilePath: string;

  constructor(options: EnvManagerOptions) {
    this.envFilePath = options.envFilePath;
  }

  /**
   * Check if .env file exists
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.envFilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and parse .env file content
   */
  async readEnvFile(): Promise<{ [key: string]: string }> {
    try {
      const content = await readFile(this.envFilePath, 'utf-8');
      return this.parseEnvContent(content);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return {}; // File doesn't exist, return empty object
      }
      throw error;
    }
  }

  /**
   * Parse .env file content into key-value pairs
   */
  private parseEnvContent(content: string): { [key: string]: string } {
    const env: { [key: string]: string } = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();
        
        // Remove surrounding quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        env[key] = cleanValue;
      }
    }

    return env;
  }

  /**
   * Convert environment object back to .env file format
   */
  private formatEnvContent(env: { [key: string]: string }): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(env)) {
      // Quote values that contain spaces or special characters
      const needsQuotes = /[\s#"']/.test(value);
      const formattedValue = needsQuotes ? `"${value}"` : value;
      lines.push(`${key}=${formattedValue}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Add or update environment variables
   */
  async setVariables(variables: EnvVariable[]): Promise<EnvUpdateResult> {
    try {
      const currentEnv = await this.readEnvFile();
      const added: string[] = [];
      const updated: string[] = [];

      // Process each variable
      for (const { key, value } of variables) {
        if (currentEnv.hasOwnProperty(key)) {
          if (currentEnv[key] !== value) {
            updated.push(key);
            currentEnv[key] = value;
          }
        } else {
          added.push(key);
          currentEnv[key] = value;
        }
      }

      // Write back to file
      const content = this.formatEnvContent(currentEnv);
      await writeFile(this.envFilePath, content, 'utf-8');

      console.log(`✅ Environment variables updated in ${this.envFilePath}`);
      if (added.length > 0) {
        console.log(`   Added: ${added.join(', ')}`);
      }
      if (updated.length > 0) {
        console.log(`   Updated: ${updated.join(', ')}`);
      }

      const result: EnvUpdateResult = {
        success: true,
        filePath: this.envFilePath
      };
      
      if (added.length > 0) {
        result.added = added;
      }
      if (updated.length > 0) {
        result.updated = updated;
      }
      
      return result;

    } catch (error) {
      console.error(`❌ Failed to update environment variables:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Remove environment variables by key patterns
   */
  async removeVariables(patterns: string[]): Promise<EnvUpdateResult> {
    try {
      const currentEnv = await this.readEnvFile();
      const removed: string[] = [];

      // Remove variables matching patterns
      for (const pattern of patterns) {
        const keysToRemove = Object.keys(currentEnv).filter(key => {
          // Check if key starts with pattern (removing = if present)
          const cleanPattern = pattern.replace(/=$/, '');
          return key === cleanPattern || key.startsWith(cleanPattern);
        });

        for (const key of keysToRemove) {
          delete currentEnv[key];
          removed.push(key);
        }
      }

      if (removed.length > 0) {
        // Write back to file
        const content = this.formatEnvContent(currentEnv);
        await writeFile(this.envFilePath, content, 'utf-8');

        console.log(`✅ Removed environment variables from ${this.envFilePath}`);
        console.log(`   Removed: ${removed.join(', ')}`);
      } else {
        console.log(`ℹ️ No matching environment variables found to remove`);
      }

      const result: EnvUpdateResult = {
        success: true,
        filePath: this.envFilePath
      };
      
      if (removed.length > 0) {
        result.removed = removed;
      }
      
      return result;

    } catch (error) {
      console.error(`❌ Failed to remove environment variables:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Remove database-related environment variables
   */
  async removeDatabaseVariables(): Promise<EnvUpdateResult> {
    const dbPatterns = [
      'DB_HOST=',
      'DB_PORT=', 
      'DB_USER=',
      'DB_PASS=',
      'DB_NAME=',
      'DATABASE_URL='
    ];

    return this.removeVariables(dbPatterns);
  }

  /**
   * Set database environment variables
   */
  async setDatabaseVariables(config: {
    host?: string;
    port?: string | number;
    user?: string;
    password?: string;
    database?: string;
    url?: string;
  }): Promise<EnvUpdateResult> {
    const variables: EnvVariable[] = [];

    if (config.host !== undefined) {
      variables.push({ key: 'DB_HOST', value: config.host });
    }
    if (config.port !== undefined) {
      variables.push({ key: 'DB_PORT', value: config.port.toString() });
    }
    if (config.user !== undefined) {
      variables.push({ key: 'DB_USER', value: config.user });
    }
    if (config.password !== undefined) {
      variables.push({ key: 'DB_PASS', value: config.password });
    }
    if (config.database !== undefined) {
      variables.push({ key: 'DB_NAME', value: config.database });
    }
    if (config.url !== undefined) {
      variables.push({ key: 'DATABASE_URL', value: config.url });
    }

    return this.setVariables(variables);
  }

  /**
   * Get current database configuration from .env
   */
  async getDatabaseConfig(): Promise<{
    host?: string;
    port?: string;
    user?: string;
    password?: string;
    database?: string;
    url?: string;
  }> {
    const env = await this.readEnvFile();

    const config: {
      host?: string;
      port?: string;
      user?: string;
      password?: string;
      database?: string;
      url?: string;
    } = {};

    if (env.DB_HOST) config.host = env.DB_HOST;
    if (env.DB_PORT) config.port = env.DB_PORT;
    if (env.DB_USER) config.user = env.DB_USER;
    if (env.DB_PASS) config.password = env.DB_PASS;
    if (env.DB_NAME) config.database = env.DB_NAME;
    if (env.DATABASE_URL) config.url = env.DATABASE_URL;

    return config;
  }

  /**
   * Create a backup of the current .env file
   */
  async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.envFilePath}.backup.${timestamp}`;
    
    try {
      const content = await readFile(this.envFilePath, 'utf-8');
      await writeFile(backupPath, content, 'utf-8');
      console.log(`✅ Created .env backup: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error(`❌ Failed to create .env backup:`, error);
      throw error;
    }
  }

  /**
   * Validate .env file syntax
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const content = await readFile(this.envFilePath, 'utf-8');
      const lines = content.split('\n');
      const errors: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() || '';
        const lineNumber = i + 1;

        // Skip empty lines and comments
        if (!line || line.startsWith('#')) {
          continue;
        }

        // Check for valid format
        if (!line.includes('=')) {
          errors.push(`Line ${lineNumber}: Missing '=' separator`);
          continue;
        }

        const equalIndex = line.indexOf('=');
        const key = line.substring(0, equalIndex).trim();

        if (!key) {
          errors.push(`Line ${lineNumber}: Empty variable name`);
        }

        if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
          errors.push(`Line ${lineNumber}: Invalid variable name '${key}'`);
        }
      }

      return {
        valid: errors.length === 0,
        errors
      };

    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to read .env file: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
}

/**
 * Create an EnvManager instance for a specific app path
 */
export function createEnvManager(appPath: string): EnvManager {
  const envFilePath = join(appPath, '.env');
  return new EnvManager({ envFilePath });
}
