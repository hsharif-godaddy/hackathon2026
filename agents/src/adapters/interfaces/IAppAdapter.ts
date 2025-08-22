// No database schema imports needed - adapters only handle deployment

export interface ServerInfo {
  appId: string;
  port: number;
  url: string;
  status: 'running' | 'stopped' | 'error' | 'building';
  type: 'local' | 'docker'; // Deployment type
  metadata?: Record<string, any>; // Additional info (containerId, pid, etc.)
}

export interface ServerStatus {
  status: 'running' | 'stopped' | 'exited' | 'dead' | 'not_found' | 'container_missing' | 'error';
  message?: string;
  metadata?: Record<string, any>;
}

export interface AppAdapterCapabilities {
  supportsContainerOperations: boolean;
  supportsProcessOperations: boolean;
  supportsRebuild: boolean;
  supportsLogs: boolean;
}

/**
 * Universal App Deployment Adapter Interface
 * Defines deployment operations that both Docker and Local services must implement
 * 
 * Note: This interface handles ONLY deployment operations (start/stop/status).
 * App creation, database operations, and file system operations are handled by AppRepository.
 */
export interface IAppAdapter {
  /**
   * Initialize the adapter
   */
  initialize(): Promise<void>;

  /**
   * Get adapter capabilities
   */
  getCapabilities(): AppAdapterCapabilities;

  /**
   * Deployment Operations
   */
  startApp(appId: string): Promise<boolean>;
  stopApp(appId: string): Promise<boolean>;
  restartApp(appId: string): Promise<boolean>;

  /**
   * Status and Information
   */
  getRunningServers(): Promise<ServerInfo[]>;
  getAppStatus(appId: string): Promise<ServerStatus>;
  getAppLogs?(appId: string): Promise<string[]>; // Optional - not all adapters support logs

  /**
   * Bulk Operations
   */
  stopAllServers(): Promise<number>;

  /**
   * Advanced Operations (Optional - adapter-specific)
   */
  rebuildApp?(appId: string): Promise<boolean>; // Docker-specific
  cleanupOrphans(): Promise<{ message: string; cleaned: number }>;

  /**
   * App-specific cleanup - remove all deployment artifacts for an app
   */
  removeApp(appId: string): Promise<boolean>;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

/**
 * Factory interface for creating adapters
 */
export interface IAppAdapterFactory {
  createAdapter(): Promise<IAppAdapter>;
  getAdapterType(): 'docker' | 'local' | 'cloud';
}
