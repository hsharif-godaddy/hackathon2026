import { Hono } from 'hono';
import { testDatabaseConnection, executeQuery } from '../services/database';

const api = new Hono();

// Health check endpoint
api.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'V3 App Template API',
    version: '1.0.0'
  });
});

// Database health check endpoint
api.get('/database/health', async (c) => {
  try {
    const testResult = await testDatabaseConnection();
    
    return c.json({
      database: testResult.success ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      ...testResult
    }, testResult.success ? 200 : 500);
  } catch (error) {
    return c.json({
      database: 'error',
      timestamp: new Date().toISOString(),
      success: false,
      message: `Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});



// Test database query endpoint
api.get('/database/test-query', async (c) => {
  try {
    const { rows } = await executeQuery(
      'SELECT ? as message, NOW() as current_time, @@version as mysql_version', 
      ['Hello from MySQL!']
    );
    
    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      query_result: rows[0],
      message: 'Database query executed successfully'
    });
  } catch (error) {
    return c.json({
      success: false,
      timestamp: new Date().toISOString(),
      message: `Database query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default api;
