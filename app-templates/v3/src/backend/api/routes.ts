import { Hono } from 'hono';

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

export default api;
