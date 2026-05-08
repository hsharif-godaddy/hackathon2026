export type InvestigationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed';

export interface InvestigationInput {
  feedback: string;
  fullstoryUrl?: string | null;
  timeWindow?: string | null;
}

export interface InvestigationState {
  investigationId: string;
  appId: string;
  customerId: string;
  status: InvestigationStatus;
  startedAt: string;
  startedBy: string;
  updatedAt: string;
  heartbeatAt: string;
  phase: string | null;
  lastEvent: string | null;
  input: InvestigationInput;
  resultKey: string | null;
  reportFilename: string | null;
  completedAt: string | null;
  durationMs: number | null;
  lambdaRequestId: string | null;
  evidence?: {
    status: 'ready' | 'uploaded' | 'partial' | 'failed';
    key?: string;
    artifactCount?: number;
    uploadedCount?: number;
    window?: {
      label: string;
      from: string;
      to: string;
      hours: number;
    };
    stats?: {
      durationMs: number;
      endpointCount: number;
      failedCount: number;
      bytes: number;
    };
    error?: string;
  };
  error: string | null;
}

export interface AcquireLockResult {
  acquired: boolean;
  existing?: InvestigationState;
  tookOverZombie?: boolean;
}

export interface InvestigationKeys {
  stateKey: string;
  resultKey: string;
  historyPrefix: string;
  tracePrefix: string;
}

export function keysFor(customerId: string, appId: string): InvestigationKeys {
  const base = `active/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}`;
  return {
    stateKey: `${base}/state.json`,
    resultKey: `${base}/result.md`,
    historyPrefix: `history/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`,
    tracePrefix: `${base}/`,
  };
}
