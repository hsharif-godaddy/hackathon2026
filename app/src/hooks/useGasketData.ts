import { gasketData, type GasketData } from '@gasket/data';

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
