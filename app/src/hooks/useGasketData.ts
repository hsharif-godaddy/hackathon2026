import { gasketData } from '@gasket/data';

declare global {
  interface Window {
    gasketData?: {
      intl?: {
        locale: string;
      },
      switchboard?: {
        [key: string]: boolean;
      }
    }
  }
}

export function useGasketData() {
  if (typeof window === 'undefined') {
    return {};
  }
  
  if (typeof window.gasketData === 'undefined') {
    window.gasketData = gasketData();
  }

  return window.gasketData;
}
