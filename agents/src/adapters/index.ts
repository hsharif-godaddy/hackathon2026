// Main exports
export { AppAdapterFactory, getAppAdapter, getAdapterType, isDockerMode } from './AppAdapterFactory.js';

// Interfaces
export type { 
  IAppAdapter, 
  IAppAdapterFactory,
  ServerInfo,
  ServerStatus,
  AppAdapterCapabilities
} from './interfaces/IAppAdapter.js';

// Common types and errors
export type {
  AdapterType,
  AppTemplateVersion,
  AdapterConfig,
  TemplateInfo
} from './interfaces/common.js';

export {
  AdapterError,
  ContainerError,
  ProcessError,
  AdapterConfigResolver
} from './interfaces/common.js';

// Services (usually not needed externally, but available for testing)
export { DockerAppService } from './services/DockerAppService.js';
export { LocalAppService } from './services/LocalAppService.js';
