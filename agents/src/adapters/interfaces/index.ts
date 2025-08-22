export type { 
  IAppAdapter, 
  IAppAdapterFactory,
  ServerInfo,
  ServerStatus,
  AppAdapterCapabilities
} from './IAppAdapter.js';

export {
  AdapterError,
  ContainerError,
  ProcessError,
  AdapterConfigResolver
} from './common.js';

export type {
  AdapterType,
  AppTemplateVersion,
  AdapterConfig,
  TemplateInfo
} from './common.js';
