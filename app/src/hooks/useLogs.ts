import { useQuery } from '@tanstack/react-query';

/**
 * Log entry structure returned from the API
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  appId?: string;
  logger?: string;
  service?: string;
  hostname?: string;
  environment?: string;
  region?: string;
  version?: string;
  raw: Record<string, unknown>;
}

/**
 * API response structure for logs
 */
interface LogsResponse {
  logs: LogEntry[];
  total: number;
  size: number;
  from: number;
}

/**
 * Parameters for fetching logs
 */
export interface LogsQueryParams {
  level: string;
  timeRange: string;
  query: string;
  appId: string;
  pageSize: number;
  page: number;
}

/**
 * Calculates the start time based on the selected time range
 *
 * @param range - The time range preset (e.g., '15m', '1h', '24h')
 * @returns ISO string for the start time or undefined for 'all'
 */
function calculateStartTime(range: string): string | undefined {
  if (range === 'all') {return undefined;}

  const now = new Date();
  const value = parseInt(range.slice(0, -1), 10);
  const unit = range.slice(-1);

  switch (unit) {
    case 'm':
      now.setMinutes(now.getMinutes() - value);
      break;
    case 'h':
      now.setHours(now.getHours() - value);
      break;
    case 'd':
      now.setDate(now.getDate() - value);
      break;
  }

  return now.toISOString();
}

/**
 * Hook to fetch logs from Elasticsearch using React Query
 *
 * @param params - Query parameters for filtering logs
 * @returns Query result with logs data, loading, error states
 */
export function useLogs(params: LogsQueryParams) {
  const { level, timeRange, query, appId, pageSize, page } = params;

  return useQuery({
    queryKey: ['logs', level, timeRange, query, appId, pageSize, page],
    queryFn: async (): Promise<{ logs: LogEntry[]; total: number }> => {
      const urlParams = new URLSearchParams();
      urlParams.set('size', pageSize.toString());
      urlParams.set('from', (page * pageSize).toString());

      if (level !== 'all') {
        urlParams.set('level', level.toLowerCase());
      }

      if (query) {
        urlParams.set('query', query);
      }

      if (appId) {
        urlParams.set('appId', appId);
      }

      const startTime = calculateStartTime(timeRange);
      if (startTime) {
        urlParams.set('startTime', startTime);
      }

      const response = await window.fetch(`/api/es-logs?${urlParams.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch logs');
      }

      const data: LogsResponse = await response.json();
      return {
        logs: data.logs,
        total: data.total
      };
    },
    staleTime: 10 * 1000, // 10 seconds - logs change frequently
    gcTime: 2 * 60 * 1000, // 2 minutes
  });
}
