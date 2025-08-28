export interface MySQLOperationData {
  username?: string;
  password?: string;
  databaseName?: string;
  originalDatabaseName?: string;
  tables?: string[];
  databases?: Array<{
    databaseName: string;
    userId?: string | null;
    username?: string;
  }>;
  testResult?: {
    success: boolean;
    message: string;
    details?: any;
  };
}

export interface MySQLOperationResult {
  success: boolean;
  message: string;
  data?: MySQLOperationData;
}

export interface EnvironmentCredentials {
  DB_HOST: string;
  DB_PORT: string;
  DB_USER: string;
  DB_PASS: string;
  DB_NAME: string;
  DATABASE_URL: string;
}

export class MySQLResponseFormatter {
  private result: MySQLOperationResult;
  private appId?: string;
  private envWriteSuccess?: boolean;
  private envWriteError: string | undefined;
  private serverRestartSuccess?: boolean;
  private serverRestartError?: string;

  constructor(result: MySQLOperationResult) {
    this.result = result;
  }

  setAppContext(appId: string): MySQLResponseFormatter {
    this.appId = appId;
    return this;
  }

  setEnvironmentWriteResult(success: boolean, error?: string): MySQLResponseFormatter {
    this.envWriteSuccess = success;
    this.envWriteError = error;
    return this;
  }

  setServerRestartResult(success: boolean, error?: string): MySQLResponseFormatter {
    this.serverRestartSuccess = success;
    if (error !== undefined) {
      this.serverRestartError = error;
    }
    return this;
  }

  renderMarkdown(): string {
    const sections: string[] = [];

    // Main operation result
    sections.push(`✅ MySQL operation successful: ${this.result.message}`);

    if (!this.result.data) {
      return sections.join('\n');
    }

    const data = this.result.data;

    // Handle different operation types
    if (this.isEnableDatabaseOperation(data)) {
      sections.push(this.renderEnableDatabaseResult(data));
    } else if (this.isTestConnectionOperation(data)) {
      sections.push(this.renderTestConnectionResult(data));
    } else if (this.isListDatabasesOperation(data)) {
      sections.push(this.renderListDatabasesResult(data));
    }

    // Environment credentials section
    if (this.shouldShowEnvironmentCredentials(data)) {
      sections.push(this.renderEnvironmentCredentials(data));
    }

    return sections.join('\n');
  }

  private isEnableDatabaseOperation(data: MySQLOperationData): boolean {
    return !!(data.username && data.password && data.databaseName);
  }

  private isTestConnectionOperation(data: MySQLOperationData): boolean {
    return !!data.testResult;
  }

  private isListDatabasesOperation(data: MySQLOperationData): boolean {
    return !!(data.databases && data.databases.length > 0);
  }

  private shouldShowEnvironmentCredentials(data: MySQLOperationData): boolean {
    return this.isEnableDatabaseOperation(data);
  }

  private renderEnableDatabaseResult(data: MySQLOperationData): string {
    const lines: string[] = ['', 'Created credentials:'];

    // Database information
    lines.push(`• Database: ${data.databaseName}`);
    if (data.originalDatabaseName && data.originalDatabaseName !== data.databaseName) {
      lines.push(`  (auto-generated from '${data.originalDatabaseName}' with unique suffix)`);
    }

    // User credentials
    lines.push(`• Username: ${data.username}`);
    lines.push(`• Password: ${data.password}`);

    // Tables if any were created
    if (data.tables && data.tables.length > 0) {
      lines.push(`• Tables: ${data.tables.join(', ')}`);
    }

    return lines.join('\n');
  }

  private renderTestConnectionResult(data: MySQLOperationData): string {
    const result = data.testResult!;
    const lines: string[] = [''];

    if (result.success) {
      lines.push('🔗 Database connection test: ✅ SUCCESS');
      if (result.details) {
        lines.push(`• Host: ${result.details.host || 'unknown'}`);
        lines.push(`• Port: ${result.details.port || 'unknown'}`);
        lines.push(`• Database: ${result.details.database || 'unknown'}`);
        if (result.details.version) {
          lines.push(`• MySQL Version: ${result.details.version}`);
        }
      }
    } else {
      lines.push('❌ Database connection test: FAILED');
      lines.push(`• Error: ${result.message}`);
      if (result.details?.error) {
        lines.push(`• Details: ${result.details.error}`);
      }
    }

    return lines.join('\n');
  }

  private renderListDatabasesResult(data: MySQLOperationData): string {
    const lines: string[] = ['', `📊 Available databases (${data.databases!.length}):`];
    
    data.databases!.forEach(database => {
      lines.push(`• ${database.databaseName}`);
      if (database.username) {
        lines.push(`  (user: ${database.username})`);
      }
      if (database.userId) {
        lines.push(`  [userId: ${database.userId}]`);
      }
    });

    return lines.join('\n');
  }

  private renderEnvironmentCredentials(data: MySQLOperationData): string {
    if (!this.appId) {
      return this.renderManualCredentials(data);
    }

    const lines: string[] = ['', '✅ Credentials automatically stored in .env file:'];
    
    // Use localhost for agent connections
    const dbHost = 'localhost';
    const databaseName = data.databaseName || 'unknown_db';
    
    lines.push(`• DB_HOST=${dbHost}`);
    lines.push(`• DB_PORT=3306`);
    lines.push(`• DB_USER=${data.username}`);
    lines.push(`• DB_PASS=${data.password}`);
    lines.push(`• DB_NAME=${databaseName}`);

    // Environment write result
    if (this.envWriteSuccess === true) {
      lines.push('', '✅ Credentials successfully written to .env file');
    } else if (this.envWriteSuccess === false) {
      lines.push('', `⚠️ Warning: Failed to write credentials to .env file: ${this.envWriteError}`);
      lines.push('Please manually update your .env file with the credentials above.');
    }

    // Server restart result (only for enable_database operations)
    if (this.serverRestartSuccess === true) {
      lines.push('', '✅ Server automatically restarted to load new database configuration');
    } else if (this.serverRestartSuccess === false) {
      lines.push('', `⚠️ Warning: Failed to restart server: ${this.serverRestartError}`);
      lines.push('Please manually restart your server using the server_restart tool.');
    }

    return lines.join('\n');
  }

  private renderManualCredentials(data: MySQLOperationData): string {
    const lines: string[] = ['', 'Store these credentials in your application\'s environment variables:'];
    const databaseName = data.databaseName || 'unknown_db';
    
    lines.push('• DB_HOST=localhost  # Use host.docker.internal for V3 template in Docker');
    lines.push('• DB_PORT=3306');
    lines.push(`• DB_USER=${data.username}`);
    lines.push(`• DB_PASS=${data.password}`);
    lines.push(`• DB_NAME=${databaseName}`);

    return lines.join('\n');
  }

  getEnvironmentCredentials(data: MySQLOperationData): EnvironmentCredentials | null {
    if (!this.isEnableDatabaseOperation(data)) {
      return null;
    }

    const dbHost = 'localhost'; // Agent runs outside Docker
    const databaseName = data.databaseName || 'unknown_db';

    return {
      DB_HOST: dbHost,
      DB_PORT: '3306',
      DB_USER: data.username!,
      DB_PASS: data.password!,
      DB_NAME: databaseName,
      DATABASE_URL: `mysql://${data.username}:${data.password}@${dbHost}:3306/${databaseName}`
    };
  }
}

/**
 * Create a formatter for MySQL operation results
 */
export function createMySQLResponseFormatter(result: MySQLOperationResult): MySQLResponseFormatter {
  return new MySQLResponseFormatter(result);
}
