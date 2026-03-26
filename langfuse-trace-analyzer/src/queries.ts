import type { MetricsQuery } from './langfuse-client.js';

interface DateRange {
  fromTimestamp: string;
  toTimestamp: string;
}

const GENERATION_ONLY = [
  { column: 'type', operator: '=', value: 'GENERATION', type: 'string' },
];

export type QueryDefinition = {
  name: string;
  metricType: string;
  build: (range: DateRange) => MetricsQuery;
};

export const definitions: QueryDefinition[] = [
  {
    name: 'observation_latency',
    metricType: 'observation_latency',
    build({ fromTimestamp, toTimestamp }: DateRange): MetricsQuery {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }],
        metrics: [
          { measure: 'latency', aggregation: 'avg' },
          { measure: 'latency', aggregation: 'p50' },
          { measure: 'latency', aggregation: 'p95' },
          { measure: 'latency', aggregation: 'p99' },
          { measure: 'streamingLatency', aggregation: 'avg' },
          { measure: 'streamingLatency', aggregation: 'p50' },
          { measure: 'streamingLatency', aggregation: 'p95' },
          { measure: 'count', aggregation: 'count' },
        ],
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_failures',
    metricType: 'observation_failures',
    build({ fromTimestamp, toTimestamp }: DateRange): MetricsQuery {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'level' }],
        metrics: [
          { measure: 'count', aggregation: 'count' },
        ],
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_tokens_cost',
    metricType: 'observation_tokens_cost',
    build({ fromTimestamp, toTimestamp }: DateRange): MetricsQuery {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'providedModelName' }],
        metrics: [
          { measure: 'inputTokens', aggregation: 'sum' },
          { measure: 'inputTokens', aggregation: 'avg' },
          { measure: 'inputTokens', aggregation: 'p95' },
          { measure: 'outputTokens', aggregation: 'sum' },
          { measure: 'outputTokens', aggregation: 'avg' },
          { measure: 'outputTokens', aggregation: 'p95' },
          { measure: 'totalTokens', aggregation: 'sum' },
          { measure: 'inputCost', aggregation: 'sum' },
          { measure: 'outputCost', aggregation: 'sum' },
          { measure: 'totalCost', aggregation: 'sum' },
          { measure: 'tokensPerSecond', aggregation: 'avg' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_throughput',
    metricType: 'observation_throughput',
    build({ fromTimestamp, toTimestamp }: DateRange): MetricsQuery {
      return {
        view: 'observations',
        dimensions: [{ field: 'providedModelName' }],
        metrics: [
          { measure: 'outputTokensPerSecond', aggregation: 'avg' },
          { measure: 'tokensPerSecond', aggregation: 'avg' },
          { measure: 'timeToFirstToken', aggregation: 'avg' },
          { measure: 'timeToFirstToken', aggregation: 'p50' },
          { measure: 'timeToFirstToken', aggregation: 'p95' },
          { measure: 'toolCalls', aggregation: 'sum' },
          { measure: 'toolDefinitions', aggregation: 'sum' },
          { measure: 'countScores', aggregation: 'sum' },
          { measure: 'countScores', aggregation: 'avg' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
  {
    name: 'observation_latency_by_model',
    metricType: 'observation_latency_by_model',
    build({ fromTimestamp, toTimestamp }: DateRange): MetricsQuery {
      return {
        view: 'observations',
        dimensions: [{ field: 'name' }, { field: 'providedModelName' }],
        metrics: [
          { measure: 'latency', aggregation: 'avg' },
          { measure: 'latency', aggregation: 'p95' },
          { measure: 'count', aggregation: 'count' },
        ],
        filters: GENERATION_ONLY,
        fromTimestamp,
        toTimestamp,
      };
    },
  },
];
