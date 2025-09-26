import { useGasketData } from '@/hooks/useGasketData';

export function useSwitchboard() {
  const gasketData = useGasketData();
  const { switchboard } = gasketData || {};

  // Check if gasketData is still loading (undefined means it's loading)
  const isLoading = gasketData === undefined;

  return {
    featureFlags: switchboard ?? {},
    isLoading
  };
}
