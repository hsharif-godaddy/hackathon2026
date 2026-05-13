import type {
  WorkspaceVersionControl,
  VersionControlStatus,
  CheckpointOptions,
  CheckpointResult,
  HistoryOptions,
  Commit,
  DiffOptions,
  DiffPatch,
  PreparePublishOptions,
} from '../version-control.js';
import type { WorkspaceVariant } from '../variant.js';
import { VariantNotApplicableError, WorkspaceNotImplementedError } from '../errors.js';

export class HttpVersionControl implements WorkspaceVersionControl {
  constructor(private readonly variant: WorkspaceVariant) {}

  private ensurePreview(method: string): void {
    if (this.variant !== 'preview') {
      throw new VariantNotApplicableError(method, this.variant);
    }
  }

  async status(): Promise<VersionControlStatus> {
    this.ensurePreview('versionControl.status');
    throw new WorkspaceNotImplementedError('versionControl.status');
  }
  async checkpoint(_options: CheckpointOptions): Promise<CheckpointResult> {
    this.ensurePreview('versionControl.checkpoint');
    throw new WorkspaceNotImplementedError('versionControl.checkpoint');
  }
  async history(_options?: HistoryOptions): Promise<Commit[]> {
    this.ensurePreview('versionControl.history');
    throw new WorkspaceNotImplementedError('versionControl.history');
  }
  async diff(_options?: DiffOptions): Promise<DiffPatch[]> {
    this.ensurePreview('versionControl.diff');
    throw new WorkspaceNotImplementedError('versionControl.diff');
  }
  async preparePublish(_options?: PreparePublishOptions): Promise<{ revision: string }> {
    this.ensurePreview('versionControl.preparePublish');
    throw new WorkspaceNotImplementedError('versionControl.preparePublish');
  }
}
