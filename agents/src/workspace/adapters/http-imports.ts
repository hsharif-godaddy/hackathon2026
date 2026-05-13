import type { WorkspaceImports, ImportStart, ImportStatus } from '../imports.js';
import type { WorkspaceVariant } from '../variant.js';
import { VariantNotApplicableError, WorkspaceNotImplementedError } from '../errors.js';

export class HttpImports implements WorkspaceImports {
  constructor(private readonly variant: WorkspaceVariant) {}

  private ensurePreview(method: string): void {
    if (this.variant !== 'preview') {
      throw new VariantNotApplicableError(method, this.variant);
    }
  }

  async start(
    _options: ImportStart,
  ): Promise<{ importId: string; state: 'queued' | 'running' }> {
    this.ensurePreview('imports.start');
    throw new WorkspaceNotImplementedError('imports.start');
  }
  async get(_importId: string): Promise<ImportStatus> {
    this.ensurePreview('imports.get');
    throw new WorkspaceNotImplementedError('imports.get');
  }
  async cancel(_importId: string): Promise<{ state: 'canceled' | 'already_finished' }> {
    this.ensurePreview('imports.cancel');
    throw new WorkspaceNotImplementedError('imports.cancel');
  }
}
