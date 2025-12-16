import { type GasketData,gasketData } from '@gasket/data';

declare module '@gasket/data' {
  interface GasketData {
    cds?: {
      componentTypes?: string[];
      api?: {
        baseUrl?: string;
        logPath?: string;
      };
      appName?: string;
      enabledRoutes?: string[];
      proxyLogPath?: string;
      depsPath?: string;
      [key: string]: unknown;
    };
  }
}

declare global {
  interface Window {
    gasketData?: GasketData;
  }
}

export function useGasketData(): GasketData {
  if (typeof window === 'undefined') {
    return {};
  }

  if (typeof window.gasketData === 'undefined') {
    window.gasketData = gasketData();
  }

  return window.gasketData || {};
}

