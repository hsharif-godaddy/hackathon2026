#!/usr/bin/env node

import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort) {
  let port = startPort;
  const maxAttempts = 100;
  
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  
  throw new Error(`Could not find an available port after checking ${maxAttempts} ports starting from ${startPort}`);
}

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    
    server.on('error', () => resolve(false));
  });
}

async function startDevelopment() {
  try {
    console.log('🚀 Starting V3 App Template development servers...\n');
    
    // Find available ports (prefer AppRepository's suggestion if provided)
    const preferredFrontendPort = parseInt(process.env.PREFERRED_FRONTEND_PORT || '5173', 10);
    const frontendPort = await findAvailablePort(preferredFrontendPort);
    const backendPort = await findAvailablePort(3000);
    
    console.log(`📋 Port allocation:`);
    console.log(`   Frontend (Vite): http://localhost:${frontendPort}`);
    console.log(`   Backend (Hono):  http://localhost:${backendPort}\n`);
    
    // Write port configuration to a temporary file for the backend to read
    const portConfig = { frontendPort, backendPort };
    fs.writeFileSync('.dev-ports.json', JSON.stringify(portConfig, null, 2));
    
    // Start backend server
    const backendEnv = {
      ...process.env,
      BACKEND_PORT: backendPort.toString(),
      FRONTEND_PORT: frontendPort.toString(),
    };
    
    const backend = spawn('npx', ['tsx', 'watch', 'src/backend/index.ts'], {
      env: backendEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    
    backend.stdout.on('data', (data) => {
      process.stdout.write(`[backend] ${data}`);
    });
    
    backend.stderr.on('data', (data) => {
      process.stderr.write(`[backend] ${data}`);
    });
    
    // Start frontend server
    const frontendEnv = {
      ...process.env,
      PORT: frontendPort.toString(),
      VITE_API_URL: `http://localhost:${backendPort}/api`,
      VITE_BACKEND_PORT: backendPort.toString(),
    };
    
    // Build Vite command arguments - add --host 0.0.0.0 when running in Docker
    const viteArgs = ['vite', '--port', frontendPort.toString()];
    
    if (process.env.RUNNING_IN_DOCKER === 'true') {
      viteArgs.push('--host', '0.0.0.0');
      console.log('🐳 Running in Docker - Vite will bind to 0.0.0.0 for external access');
    } else {
      console.log('💻 Running locally - Vite will bind to localhost only');
    }
    
    const frontend = spawn('npx', viteArgs, {
      env: frontendEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    
    frontend.stdout.on('data', (data) => {
      process.stdout.write(`[frontend] ${data}`);
    });
    
    frontend.stderr.on('data', (data) => {
      process.stderr.write(`[frontend] ${data}`);
    });
    
    // Handle graceful shutdown
    const cleanup = () => {
      console.log('\n🛑 Shutting down development servers...');
      
      // Clean up port config file
      try {
        fs.unlinkSync('.dev-ports.json');
      } catch (err) {
        // Ignore if file doesn't exist
      }
      
      backend.kill('SIGTERM');
      frontend.kill('SIGTERM');
      
      setTimeout(() => {
        backend.kill('SIGKILL');
        frontend.kill('SIGKILL');
        process.exit(0);
      }, 2000);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    // Handle process exits
    backend.on('exit', (code) => {
      if (code !== 0) {
        console.error(`❌ Backend server exited with code ${code}`);
        cleanup();
      }
    });
    
    frontend.on('exit', (code) => {
      if (code !== 0) {
        console.error(`❌ Frontend server exited with code ${code}`);
        cleanup();
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start development servers:', error);
    process.exit(1);
  }
}

startDevelopment();
