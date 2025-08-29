/**
 * Base interfaces for structured logging with hierarchical required fields
 */

// Base domain interfaces - each domain enforces its required context
export interface AppEventData {
  appId: string;  // Required for all app.* events
}

export interface DockerEventData {
  containerId: string;  // Required for all docker.* events
}

export interface ProcessEventData {
  processId: number;    // Required for all process.* events
}

export interface FileEventData {
  path: string;         // Required for all file.* events
}

export interface ToolEventData {
  toolName: string;     // Required for all tool.* events
}

// Standard lifecycle states for consistent 3rd level naming
export type LifecycleState = 
  | 'begin'      // Operation starting
  | 'progress'   // Operation in progress  
  | 'success'    // Operation completed successfully
  | 'failure'    // Operation failed
  | 'abort'      // Operation was cancelled
  | 'retry'      // Operation being retried
  | 'timeout';   // Operation timed out

// Standard resource states
export type ResourceState =
  | 'create'     // Resource being created
  | 'ready'      // Resource is ready for use
  | 'update'     // Resource being updated
  | 'destroy'    // Resource being destroyed
  | 'missing'    // Resource not found
  | 'corrupt';   // Resource exists but is invalid

// Standard operation types for consistency
export type OperationType =
  | 'init'       // Initialization
  | 'setup'      // Configuration/setup
  | 'install'    // Installation
  | 'build'      // Build process
  | 'deploy'     // Deployment
  | 'cleanup'    // Cleanup operations
  | 'validate'   // Validation
  | 'recover';   // Recovery operations

// Common field interfaces for reuse
export interface DurationInfo {
  duration: number;        // milliseconds
  startTime?: string;      // ISO timestamp
  endTime?: string;        // ISO timestamp
}

export interface ResourceUsage {
  memory?: {
    rss: number;           // bytes
    heapUsed: number;      // bytes
    external: number;      // bytes
  };
  cpu?: {
    user: number;          // percentage
    system: number;        // percentage
  };
  diskSpace?: {
    available: number;     // bytes
    used: number;          // bytes
    total: number;         // bytes
  };
}

export interface ErrorContext {
  errorType: string;
  retryAttempt?: number;
  maxRetries?: number;
  recoverable: boolean;
  suggestedAction?: string;
}

export interface NetworkInfo {
  port: number;
  host?: string;
  protocol?: 'http' | 'https' | 'ws' | 'wss';
  url?: string;
}