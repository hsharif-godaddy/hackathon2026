import { getDatabase } from '../database/connection.js';
import { createServer } from 'net';

/**
 * Port Manager
 * Manages port allocation for apps starting from 5000
 */
export class PortManager {
  private db = getDatabase();
  private readonly START_PORT = 5000;
  private readonly MAX_PORT = 65535;

  /**
   * Find the next available port starting from 5000
   */
  async getNextAvailablePort(): Promise<number> {
    // Get all currently used ports from the database
    const stmt = this.db.prepare(`SELECT port FROM apps ORDER BY port ASC`);
    const usedPorts = (stmt.all() as Array<{ port: number }>).map(row => row.port);

    // Find the first available port starting from START_PORT
    for (let port = this.START_PORT; port <= this.MAX_PORT; port++) {
      if (!usedPorts.includes(port) && await this.isPortAvailable(port)) {
        return port;
      }
    }

    throw new Error('No available ports found');
  }

  /**
   * Check if a port is available on the system
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get all allocated ports
   */
  getAllocatedPorts(): number[] {
    const stmt = this.db.prepare(`SELECT port FROM apps ORDER BY port ASC`);
    return (stmt.all() as Array<{ port: number }>).map(row => row.port);
  }

  /**
   * Check if a specific port is allocated to an app
   */
  isPortAllocated(port: number): boolean {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM apps WHERE port = ?`);
    const result = stmt.get(port) as { count: number };
    return result.count > 0;
  }

  /**
   * Get the app that owns a specific port
   */
  getAppByPort(port: number): { id: string; name: string } | null {
    const stmt = this.db.prepare(`SELECT id, name FROM apps WHERE port = ?`);
    const result = stmt.get(port) as { id: string; name: string } | undefined;
    return result || null;
  }
}
