import { logger } from '../../request-context';

export interface DevAppInfo {
  appId: string;
  port: number;
  supervisorPort?: number;
  publishSupervisorPort?: number;
  publishPort?: number;
  appPath: string;
  templateVersion: string;
  status: 'creating' | 'created' | 'error' | 'running' | 'stopped';
  createdAt: Date;
  updatedAt: Date;
}

export interface RunningProcess {
  id: string;
  appId: string;
  pid: number;
  port: number;
  startedAt: string;
  status: 'running' | 'stopped';
}

/**
 * Database operations for dev environment
 * Uses in-memory storage to avoid async pollution
 * Data persists only during the dev session
 * Singleton to ensure all instances share the same state
 */
export class DevDatabase {
  private static instance: DevDatabase | null = null;

  private devApps = new Map<string, DevAppInfo>();
  private runningProcesses = new Map<string, RunningProcess>();
  private portAllocations = new Set<number>();

  private constructor() {
    // In-memory storage, no initialization needed
  }

  /**
   * Get singleton instance of DevDatabase
   * Ensures all DevEnvironmentManager instances share the same in-memory state
   */
  static getInstance(): DevDatabase {
    if (!DevDatabase.instance) {
      DevDatabase.instance = new DevDatabase();
    }
    return DevDatabase.instance;
  }

  /**
   * Initialize dev-specific database tables (no-op for in-memory)
   */
  initializeTables(): void {
    // No initialization needed for in-memory storage
  }

  /**
   * Find dev app info by ID
   */
  findDevAppById(appId: string): DevAppInfo | null {
    return this.devApps.get(appId) || null;
  }

  /**
   * Create a new dev app record
   */
  createDevApp(devApp: Omit<DevAppInfo, 'createdAt' | 'updatedAt'>): DevAppInfo {
    // Check if app already exists to prevent duplicate creation
    const existing = this.findDevAppById(devApp.appId);
    if (existing) {
      logger.info(`⚠️ Dev app ${devApp.appId} already exists, returning existing record`);
      return existing;
    }

    const now = new Date();
    const fullDevApp: DevAppInfo = {
      ...devApp,
      templateVersion: devApp.templateVersion || 'v8',
      createdAt: now,
      updatedAt: now,
    };

    this.devApps.set(devApp.appId, fullDevApp);
    this.portAllocations.add(devApp.port);

    // Track supervisor port allocation if provided
    if (devApp.supervisorPort) {
      this.portAllocations.add(devApp.supervisorPort);
    }

    // Track publish supervisor port allocation if provided
    if (devApp.publishSupervisorPort) {
      this.portAllocations.add(devApp.publishSupervisorPort);
    }

    // Track publish HTTP port allocation if provided
    if (devApp.publishPort) {
      this.portAllocations.add(devApp.publishPort);
    }

    return fullDevApp;
  }

  /**
   * Update dev app status
   */
  updateDevAppStatus(appId: string, status: DevAppInfo['status']): boolean {
    const app = this.devApps.get(appId);
    if (!app) {return false;}
    
    app.status = status;
    app.updatedAt = new Date();
    this.devApps.set(appId, app);
    
    return true;
  }

  /**
   * Delete a dev app
   */
  deleteDevApp(appId: string): boolean {
    const app = this.devApps.get(appId);
    if (!app) {return false;}

    this.devApps.delete(appId);
    this.portAllocations.delete(app.port);

    // Remove supervisor port allocation if it exists
    if (app.supervisorPort) {
      this.portAllocations.delete(app.supervisorPort);
    }

    // Remove publish supervisor port allocation if it exists
    if (app.publishSupervisorPort) {
      this.portAllocations.delete(app.publishSupervisorPort);
    }

    // Remove publish HTTP port allocation if it exists
    if (app.publishPort) {
      this.portAllocations.delete(app.publishPort);
    }

    // Remove related running processes
    for (const [processId, process] of this.runningProcesses.entries()) {
      if (process.appId === appId) {
        this.runningProcesses.delete(processId);
      }
    }

    return true;
  }

  /**
   * Add a running process record
   */
  addProcessRecord(appId: string, pid: number, port: number): string {
    const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const process: RunningProcess = {
      id: processId,
      appId,
      pid,
      port,
      startedAt: new Date().toISOString(),
      status: 'running'
    };
    
    this.runningProcesses.set(processId, process);
    return processId;
  }

  /**
   * Remove process record by app ID
   */
  removeProcessRecord(appId: string): void {
    for (const [processId, process] of this.runningProcesses.entries()) {
      if (process.appId === appId) {
        this.runningProcesses.delete(processId);
      }
    }
  }

  /**
   * Get running processes
   */
  getRunningProcesses(): RunningProcess[] {
    return Array.from(this.runningProcesses.values()).filter(p => p.status === 'running');
  }

  /**
   * Check if a dev app exists
   */
  devAppExists(appId: string): boolean {
    return this.devApps.has(appId);
  }

  /**
   * Get all allocated ports
   */
  getAllocatedPorts(): number[] {
    return Array.from(this.portAllocations).sort((a, b) => a - b);
  }

  /**
   * Check if a specific port is allocated
   */
  isPortAllocated(port: number): boolean {
    return this.portAllocations.has(port);
  }

  /**
   * Get the app that owns a specific port
   */
  getAppByPort(port: number): { appId: string } | null {
    for (const app of this.devApps.values()) {
      if (app.port === port) {
        return { appId: app.appId };
      }
    }
    return null;
  }
}