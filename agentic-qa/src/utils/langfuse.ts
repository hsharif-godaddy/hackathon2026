export interface LangfuseCredentials {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  projectId?: string;
}

interface LangfuseTrace {
  id: string;
  userId?: string;
  sessionId?: string;
  name?: string;
  timestamp: string;
}

interface TracesResponse {
  data: LangfuseTrace[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface ObservationUsage {
  input?: number;
  output?: number;
  total?: number;
  unit?: string;
}

interface LangfuseObservation {
  id: string;
  traceId: string;
  type: string;
  name?: string;
  model?: string;
  level?: string;
  statusMessage?: string;
  usage?: ObservationUsage;
  totalCost?: number;
  startTime?: string;
  endTime?: string;
}

interface ObservationsResponse {
  data: LangfuseObservation[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface BuildMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUSD: number;
  turns: number;
  models: string[];
  toolNames: string[];
  toolErrorCount: number;
  toolFailedNames: string[];
  toolErrors: string[];
  toolUsage: Array<{ name: string; count: number }>;
}

const INGESTION_POLL_INTERVALS = [3_000, 5_000, 10_000, 15_000];

/**
 * Pure aggregation of Langfuse observations into BuildMetrics.
 * Exported for direct unit testing without mocking HTTP calls.
 */
export function aggregate(observations: LangfuseObservation[]): BuildMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCostUSD = 0;
  let turns = 0;
  const modelSet = new Set<string>();
  const toolFailedNames: string[] = [];
  const toolErrors: string[] = [];
  let toolErrorCount = 0;
  const toolCounts: Record<string, number> = {};

  for (const obs of observations) {
    if (obs.type === 'GENERATION') {
      turns++;
      inputTokens += obs.usage?.input ?? 0;
      outputTokens += obs.usage?.output ?? 0;
      totalCostUSD += obs.totalCost ?? 0;
      if (obs.model) modelSet.add(obs.model);
    }

    if (obs.type === 'SPAN' && obs.name) {
      toolCounts[obs.name] = (toolCounts[obs.name] ?? 0) + 1;
    }

    if (obs.level === 'ERROR' && obs.type === 'SPAN') {
      toolErrorCount++;
      if (obs.name) toolFailedNames.push(obs.name);
      if (obs.statusMessage) toolErrors.push(obs.statusMessage);
    }
  }

  const toolUsage = Object.entries(toolCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
    turns,
    models: [...modelSet],
    toolNames: Object.keys(toolCounts),
    toolErrorCount,
    toolFailedNames,
    toolErrors,
    toolUsage,
  };
}

function authHeader(creds: LangfuseCredentials): string {
  return `Basic ${Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString('base64')}`;
}

async function request<T>(creds: LangfuseCredentials, path: string): Promise<T> {
  const response = await fetch(`${creds.baseUrl}${path}`, {
    headers: {
      'Authorization': authHeader(creds),
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(body unavailable)');
    throw new Error(`Langfuse API error: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json() as Promise<T>;
}

// TODO: Traces are scoped only by userId (appId) + time window. If another service
// emits Langfuse traces for the same appId during the scenario window, those traces
// will be included and silently inflate token/cost aggregates. The builder agent
// currently does not set a trace name, so we cannot filter by name. Once it does,
// add a `name` filter here to scope results to the website-building agent only.
async function listTraces(
  creds: LangfuseCredentials,
  options: { userId: string; fromTimestamp: string; toTimestamp: string }
): Promise<LangfuseTrace[]> {
  const traces: LangfuseTrace[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      userId: options.userId,
      fromTimestamp: options.fromTimestamp,
      toTimestamp: options.toTimestamp,
      page: String(page),
      limit: String(limit),
    });

    const result = await request<TracesResponse>(creds, `/api/public/traces?${params}`);
    traces.push(...result.data);

    if (page >= result.meta.totalPages) break;
    page++;
  }

  return traces;
}

async function listObservations(
  creds: LangfuseCredentials,
  traceId: string
): Promise<LangfuseObservation[]> {
  const observations: LangfuseObservation[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      traceId,
      page: String(page),
      limit: String(limit),
    });

    const result = await request<ObservationsResponse>(creds, `/api/public/observations?${params}`);
    observations.push(...result.data);

    if (page >= result.meta.totalPages) break;
    page++;
  }

  return observations;
}

/**
 * Fetch aggregated build metrics from Langfuse for a specific app within a time window.
 * Waits briefly for Langfuse ingestion before querying.
 *
 * @param appId - The Airo app ID (mapped to Langfuse userId)
 * @param startTime - Scenario start time (epoch ms)
 * @param endTime - Scenario end time (epoch ms)
 */
export async function fetchBuildMetrics(
  creds: LangfuseCredentials,
  appId: string,
  startTime: number,
  endTime: number
): Promise<BuildMetrics | null> {
  try {
    console.log('\n========== LANGFUSE BUILD METRICS ==========');
    console.log(`Base URL:    ${creds.baseUrl}`);
    console.log(`Project ID:  ${creds.projectId ?? 'not set'}`);
    console.log(`App ID:      ${appId}`);
    console.log(`Time window: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
    const maxWait = INGESTION_POLL_INTERVALS.reduce((a, b) => a + b, 0);
    console.log(`Polling for Langfuse traces (max ${(maxWait / 1000).toFixed(0)}s)...`);

    const traceQuery = {
      userId: appId,
      fromTimestamp: new Date(startTime).toISOString(),
      toTimestamp: new Date(endTime).toISOString(),
    };

    let traces = await listTraces(creds, traceQuery);
    let elapsed = 0;

    if (traces.length === 0) {
      for (const interval of INGESTION_POLL_INTERVALS) {
        await new Promise(resolve => setTimeout(resolve, interval));
        elapsed += interval;

        traces = await listTraces(creds, traceQuery);
        if (traces.length > 0) {
          console.log(`Found traces after ${(elapsed / 1000).toFixed(0)}s`);
          break;
        }

        console.log(`  No traces yet after ${(elapsed / 1000).toFixed(0)}s, retrying...`);
      }
    } else {
      console.log('Found traces immediately');
    }

    if (traces.length === 0) {
      console.log('No Langfuse traces found for this app/window');
      console.log('==============================================\n');
      return null;
    }

    console.log(`Found ${traces.length} traces`);

    const allObservations = await Promise.all(
      traces.map(trace => listObservations(creds, trace.id))
    );

    const metrics = aggregate(allObservations.flat());

    console.log(`Turns (generations): ${metrics.turns}`);
    console.log(`Input tokens:  ${metrics.inputTokens.toLocaleString()}`);
    console.log(`Output tokens: ${metrics.outputTokens.toLocaleString()}`);
    console.log(`Total tokens:  ${metrics.totalTokens.toLocaleString()}`);
    console.log(`Total cost:    $${metrics.totalCostUSD}`);
    console.log(`Models:        ${metrics.models.join(', ') || 'unknown'}`);
    const toolSummary = metrics.toolUsage.map(t => `${t.name}(${t.count})`).join(', ');
    console.log(`Tool usage:    ${toolSummary || 'none'}`);
    console.log(`Tool errors:   ${metrics.toolErrorCount}`);
    console.log(`Failed tools:  ${metrics.toolFailedNames.length > 0 ? metrics.toolFailedNames.join(', ') : 'none'}`);
    if (metrics.toolErrors.length > 0) {
      console.log(`Error msgs:    ${metrics.toolErrors.join(' | ')}`);
    }
    console.log('==============================================\n');

    return metrics;
  } catch (error) {
    console.warn('Failed to fetch Langfuse build metrics: %s', error);
    return null;
  }
}

/**
 * Create Langfuse credentials from environment variables.
 * Returns null if not configured.
 */
export function loadCredentials(): LangfuseCredentials | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) return null;

  return {
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://agentobser-langfuse.int.godaddy.com',
    projectId: process.env.LANGFUSE_PROJECT_ID || undefined,
  };
}

/**
 * Extract the Airo appId from a preview URL subdomain.
 * The agents service uses the preview subdomain as the Langfuse userId.
 * URL pattern: {appId}.preview.{cluster}.airoapp.ai
 */
export function extractAppId(pageUrl: string): string | null {
  const match = pageUrl.match(/\/\/([^.]+)\.preview\.[^.]+\.airoapp\.ai/);
  return match?.[1] ?? null;
}
