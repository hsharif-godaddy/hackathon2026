import { MySQLUtils, DatabaseCredentials, TableColumn, TableDataResult } from '../utils/mysql-utils.js';

export { DatabaseCredentials };

/**
 * MySQLTool - Thin wrapper around MySQLUtils for backward compatibility
 * Provides CRUD operations for existing MySQL databases
 *
 * Note: Database creation is handled by DockerDatabaseManager in the app service
 */
export class MySQLTool {
  private mysqlUtils: MySQLUtils;

  constructor() {
    this.mysqlUtils = new MySQLUtils();
  }

  /**
   * List all tables in a specific database
   * Public method for use by API endpoints
   *
   * @param credentials - Database credentials
   * @returns Array of table names
   */
  async listTablesForDatabase(credentials: DatabaseCredentials): Promise<string[]> {
    return this.mysqlUtils.listTables(credentials);
  }

  /**
   * Get table schema information
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @returns Array of column information
   */
  async getTableSchema(credentials: DatabaseCredentials, tableName: string): Promise<TableColumn[]> {
    return this.mysqlUtils.getTableSchema(credentials, tableName);
  }

  /**
   * Get table data with pagination
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param page - Page number (1-indexed)
   * @param limit - Number of rows per page
   * @returns Paginated table data
   */
  async getTableData(
    credentials: DatabaseCredentials,
    tableName: string,
    page: number = 1,
    limit: number = 25
  ): Promise<TableDataResult> {
    return this.mysqlUtils.getTableData(credentials, tableName, page, limit);
  }

  /**
   * Insert a new row into a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param data - Column-value pairs for the new row
   */
  async insertRow(
    credentials: DatabaseCredentials,
    tableName: string,
    data: Record<string, any>
  ): Promise<void> {
    return this.mysqlUtils.insertRow(credentials, tableName, data);
  }

  /**
   * Update an existing row in a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   * @param data - Column-value pairs to update
   */
  async updateRow(
    credentials: DatabaseCredentials,
    tableName: string,
    primaryKey: Record<string, any>,
    data: Record<string, any>
  ): Promise<void> {
    return this.mysqlUtils.updateRow(credentials, tableName, primaryKey, data);
  }

  /**
   * Delete a row from a table
   *
   * @param credentials - Database credentials
   * @param tableName - Name of the table
   * @param primaryKey - Primary key column-value pairs for WHERE clause
   */
  async deleteRow(
    credentials: DatabaseCredentials,
    tableName: string,
    primaryKey: Record<string, any>
  ): Promise<void> {
    return this.mysqlUtils.deleteRow(credentials, tableName, primaryKey);
  }
}
