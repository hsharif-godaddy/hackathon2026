import { createServer } from 'net';

import { logger } from '../../request-context';
import { DevDatabase } from '../database/DevDatabase';

/**
 * Port Manager
 * Manages port allocation for dev apps starting from 5000
 * Manages supervisor port allocation starting from 8877
 */
export class PortManager {
  private devDb: DevDatabase;
  private readonly START_PORT = 5000;
  private readonly START_SUPERVISOR_PORT = 8877;
  private readonly MAX_PORT = 65535;

  constructor(devDb: DevDatabase) {
    this.devDb = devDb;
  }

  /**
   * Find the next available port starting from 5000
   * Uses database-level checking with retry logic to handle race conditions
   */
  async getNextAvailablePort(): Promise<number> {
    const maxRetries = 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Get all currently used ports from the dev database (fresh query each time)
      const usedPorts = this.devDb.getAllocatedPorts();

      // Find the first available port starting from START_PORT
      for (let port = this.START_PORT; port <= this.MAX_PORT; port++) {
        if (!usedPorts.includes(port) && await this.isPortAvailable(port)) {
          // Double-check the database again right before returning
          // This helps catch race conditions where another process allocated this port
          const freshUsedPorts = this.devDb.getAllocatedPorts();
          if (!freshUsedPorts.includes(port)) {
            logger.info(`✅ Port ${port} allocated successfully (attempt ${attempt + 1})`);
            return port;
          } else {
            logger.info(`⚠️ Port ${port} was allocated by another process, retrying...`);
            break; // Break inner loop to retry with fresh port list
          }
        }
      }
      
      if (attempt < maxRetries - 1) {
        // Small delay before retry to avoid tight polling
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
    }

    throw new Error('No available ports found after multiple attempts');
  }

  /**
   * Check if a port is available on the system
   * Uses lsof to check for actual processes using the port
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      // Check if any process is actually using this port
      const { stdout } = await execAsync(`lsof -i :${port}`);
      
      // If lsof returns any output, the port is in use
      if (stdout.trim()) {
        logger.info(`🚫 Port ${port} is occupied by existing process:`);
        logger.info(stdout.trim());
        return false;
      }
      
      // Double-check by trying to bind to the port
      return new Promise((resolve) => {
        const server = createServer();
        
        server.listen(port, () => {
          server.close(() => {
            logger.info(`✅ Port ${port} is available`);
            resolve(true);
          });
        });
        
        server.on('error', () => {
          logger.info(`❌ Port ${port} failed bind test`);
          resolve(false);
        });
      });
      
    } catch (error) {
      // If lsof fails (port not in use), fall back to bind test
      return new Promise((resolve) => {
        const server = createServer();
        
        server.listen(port, () => {
          server.close(() => {
            logger.info(`✅ Port ${port} is available (lsof fallback)`);
            resolve(true);
          });
        });
        
        server.on('error', () => {
          logger.info(`❌ Port ${port} failed bind test (lsof fallback)`);
          resolve(false);
        });
      });
    }
  }

  /**
   * Find the next available supervisor port starting from 8877
   * Uses the same allocation strategy as getNextAvailablePort() but in a different range
   */
  async getNextAvailableSupervisorPort(): Promise<number> {
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Get all currently used ports from the dev database (fresh query each time)
      const usedPorts = this.devDb.getAllocatedPorts();

      // Find the first available port starting from START_SUPERVISOR_PORT
      for (let port = this.START_SUPERVISOR_PORT; port <= this.MAX_PORT; port++) {
        if (!usedPorts.includes(port) && await this.isPortAvailable(port)) {
          // Double-check the database again right before returning
          // This helps catch race conditions where another process allocated this port
          const freshUsedPorts = this.devDb.getAllocatedPorts();
          if (!freshUsedPorts.includes(port)) {
            logger.info(`✅ Supervisor port ${port} allocated successfully (attempt ${attempt + 1})`);
            return port;
          } else {
            logger.info(`⚠️ Supervisor port ${port} was allocated by another process, retrying...`);
            break; // Break inner loop to retry with fresh port list
          }
        }
      }

      if (attempt < maxRetries - 1) {
        // Small delay before retry to avoid tight polling
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
    }

    throw new Error('No available supervisor ports found after multiple attempts');
  }

  /**
   * Get all allocated ports
   */
  getAllocatedPorts(): number[] {
    return this.devDb.getAllocatedPorts();
  }

  /**
   * Check if a specific port is allocated to an app
   */
  isPortAllocated(port: number): boolean {
    return this.devDb.isPortAllocated(port);
  }

  /**
   * Get the app that owns a specific port
   */
  getAppByPort(port: number): { appId: string } | null {
    return this.devDb.getAppByPort(port);
  }
}