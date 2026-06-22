export type PublishPhase = 'building' | 'deploying' | 'deployed' | 'failed';

export interface PublishJob {
  jobId: string;
  appId: string;
  phase: PublishPhase;
  commitHash: string | null;
  version: string | null;
  error: string | null;
  logs: string[] | null;
  startedAt: number;
  buildTimeoutSeconds: number | null;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_LIFETIME_MS = 12 * 60 * 1000;

let counter = 0;

function generateJobId(): string {
  return `pub_${Date.now().toString(36)}_${(counter++).toString(36)}`;
}

export class PublishJobRegistry {
  private jobs = new Map<string, PublishJob>();

  create(appId: string): PublishJob {
    const existing = this.get(appId);
    if (existing && existing.phase !== 'deployed' && existing.phase !== 'failed') {
      throw new ConflictError(appId, existing);
    }

    const job: PublishJob = {
      jobId: generateJobId(),
      appId,
      phase: 'building',
      commitHash: null,
      version: null,
      error: null,
      logs: null,
      startedAt: Date.now(),
      buildTimeoutSeconds: null,
    };

    this.jobs.set(appId, job);
    return job;
  }

  get(appId: string): PublishJob | null {
    const job = this.jobs.get(appId);
    if (!job) return null;

    const elapsed = Date.now() - job.startedAt;
    if (elapsed > TTL_MS && (job.phase === 'deployed' || job.phase === 'failed')) {
      this.jobs.delete(appId);
      return null;
    }
    if (elapsed > MAX_LIFETIME_MS && (job.phase === 'building' || job.phase === 'deploying')) {
      this.jobs.delete(appId);
      return null;
    }

    return job;
  }

  update(appId: string, fields: Partial<Pick<PublishJob, 'phase' | 'commitHash' | 'version' | 'error' | 'logs' | 'buildTimeoutSeconds'>>, jobId?: string): PublishJob | null {
    const job = this.jobs.get(appId);
    if (!job) return null;
    if (jobId && job.jobId !== jobId) return null;

    Object.assign(job, fields);
    return job;
  }

  clear(appId: string): void {
    this.jobs.delete(appId);
  }
}

export class ConflictError extends Error {
  constructor(public readonly appId: string, public readonly activeJob: PublishJob) {
    super(`Publish already in progress for app ${appId}`);
    this.name = 'ConflictError';
  }
}

export const publishJobRegistry = new PublishJobRegistry();
