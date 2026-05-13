import type { WorkspaceVariant } from './variant.js';

export class WorkspaceUnavailableError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly variant: WorkspaceVariant,
    detail?: string,
  ) {
    super(`Workspace ${workspaceId} (${variant}) unavailable${detail ? `: ${detail}` : ''}`);
    this.name = 'WorkspaceUnavailableError';
  }
}

export class VariantNotApplicableError extends Error {
  constructor(
    public readonly method: string,
    public readonly variant: WorkspaceVariant,
  ) {
    super(`${method} is not applicable on the ${variant} variant`);
    this.name = 'VariantNotApplicableError';
  }
}

export class WorkspaceNotImplementedError extends Error {
  constructor(public readonly method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'WorkspaceNotImplementedError';
  }
}

export class WorkspaceTaskFailedError extends Error {
  constructor(
    public readonly taskId: string,
    reason: string,
    public readonly exitCode?: number,
  ) {
    super(`Workspace task ${taskId} failed: ${reason}`);
    this.name = 'WorkspaceTaskFailedError';
  }
}

export class WorkspaceValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'WorkspaceValidationError';
  }
}
