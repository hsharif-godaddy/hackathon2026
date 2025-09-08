import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { readFileSync } from 'fs';
import api from './api/routes';
import { findAvailablePort } from './utils/port-finder';

const app = new Hono();

// Read port configuration if available
let frontendPort = 5173;
try {
  const portConfig = JSON.parse(readFileSync('.dev-ports.json', 'utf8'));
  frontendPort = portConfig.frontendPort || 5173;

} catch {
  // Use default if config file doesn't exist
}

// Global middleware
app.use('*', logger());
const corsOrigin = [
  `http://localhost:${frontendPort}`,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
];

if (process.env.FRONTEND_DOMAIN) {
  corsOrigin.push(...[process.env.FRONTEND_DOMAIN, `http://${process.env.FRONTEND_DOMAIN}`, `https://${process.env.FRONTEND_DOMAIN}`]);
}

app.use('/api/*', cors({
  origin: corsOrigin,
  credentials: true,
}));

// API routes
app.route('/api', api);

// Static file serving will be handled by the frontend dev server
// In production, you would typically serve static files here

// Global error handler
app.onError((err, c) => {
  console.error(`Error: ${err.message}`, err.stack);
  
  // In development, return detailed error
  if (process.env.NODE_ENV === 'development') {
    return c.json({ 
      error: err.message,
      stack: err.stack,
    }, 500);
  }
  
  // In production, return generic error
  return c.json({ error: 'Internal Server Error' }, 500);
});

async function startServer() {
  try {
    // If BACKEND_PORT is explicitly set (by AppRepository), use it directly
    // Otherwise, use port discovery for manual starts
    const backendPort = process.env.BACKEND_PORT;
    let port: number;
    
    if (backendPort) {
      // Use the exact port provided by AppRepository
      port = parseInt(backendPort, 10);
      console.log(`🚀 Backend server starting on allocated port http://localhost:${port}`);
    } else {
      // Find available port for manual starts
      const preferredPort = parseInt(process.env.PORT || '3000', 10);
      port = await findAvailablePort(preferredPort);
      console.log(`🚀 Backend server starting on discovered port http://localhost:${port}`);
    }
    
    serve({
      fetch: app.fetch,
      port,
      hostname: '0.0.0.0',
    });
    
    console.log(`✅ Backend server ready on http://localhost:${port}`);
  } catch (error) {
    console.error('❌ Failed to start backend server:', error);
    process.exit(1);
  }
}

startServer();
