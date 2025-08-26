import mysql from 'mysql2/promise';
import { Pool, PoolConnection } from 'mysql2/promise';

// Database configuration interface
interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

// Database connection pool
let pool: Pool | null = null;

/**
 * Get database configuration from environment variables
 */
function getDatabaseConfig(): DatabaseConfig {
  // Detect if running in Docker and adjust host accordingly
  let dbHost = process.env.DB_HOST || 'localhost';
  
  // If running in Docker and host is localhost, use Docker host
  if (process.env.RUNNING_IN_DOCKER === 'true' && (dbHost === 'localhost' || dbHost === '127.0.0.1')) {
    // Try host.docker.internal first (works on Docker Desktop)
    dbHost = 'host.docker.internal';
    console.log('🐳 Running in Docker, using host.docker.internal for database connection');
  }
  
  const config: DatabaseConfig = {
    host: dbHost,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || '',
    connectionLimit: 10,
  };

  // Validate required configuration
  if (!config.user || !config.password || !config.database) {
    throw new Error('Missing required database configuration. Please check DB_USER, DB_PASS, and DB_NAME environment variables.');
  }

  console.log(`🔗 Database config: ${config.user}@${config.host}:${config.port}/${config.database}`);
  
  return config;
}

/**
 * Initialize database connection pool
 */
export function initializeDatabase(): Pool {
  try {
    const config = getDatabaseConfig();
    
    console.log(`🔗 Initializing database connection to ${config.host}:${config.port}/${config.database}`);
    
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
      // Additional MySQL options
      charset: 'utf8mb4',
      timezone: '+00:00',
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: false,
      // SSL configuration (uncomment if needed)
      // ssl: {
      //   rejectUnauthorized: false
      // }
    });

    console.log('✅ Database connection pool initialized successfully');
    return pool;
  } catch (error) {
    console.error('❌ Failed to initialize database connection pool:', error);
    throw error;
  }
}

/**
 * Get database connection pool
 */
export function getDatabase(): Pool {
  if (!pool) {
    pool = initializeDatabase();
  }
  return pool;
}

/**
 * Test database connection
 */
export async function testDatabaseConnection(): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const db = getDatabase();
    const connection = await db.getConnection();
    
    try {
      // Test basic connectivity
      const [rows] = await connection.execute('SELECT 1 as test, NOW() as timestamp, VERSION() as version');
      const result = rows as any[];
      
      console.log('✅ Database connection test successful');
      
      return {
        success: true,
        message: 'Database connection successful',
        details: {
          test: result[0]?.test,
          timestamp: result[0]?.timestamp,
          version: result[0]?.version,
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || '3306',
          database: process.env.DB_NAME || 'unknown'
        }
      };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    
    return {
      success: false,
      message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '3306',
        database: process.env.DB_NAME || 'unknown',
        user: process.env.DB_USER || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

/**
 * Execute a query with automatic connection management
 */
export async function executeQuery<T = any>(
  query: string, 
  params: any[] = []
): Promise<{ rows: T[]; fields: any[] }> {
  const db = getDatabase();
  const connection = await db.getConnection();
  
  try {
    const [rows, fields] = await connection.execute(query, params);
    return { rows: rows as T[], fields };
  } finally {
    connection.release();
  }
}

/**
 * Execute a transaction with automatic rollback on error
 */
export async function executeTransaction<T>(
  callback: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const db = getDatabase();
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Close database connection pool
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      pool = null;
      console.log('✅ Database connection pool closed');
    } catch (error) {
      console.error('❌ Error closing database connection pool:', error);
      throw error;
    }
  }
}





// Initialize database connection on module load
try {
  initializeDatabase();
} catch (error) {
  console.warn('⚠️ Database initialization failed on module load. Will retry on first use.');
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing database connections...');
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing database connections...');
  await closeDatabaseConnection();
  process.exit(0);
});
