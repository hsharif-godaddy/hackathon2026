import type {
  WorkspaceFiles,
  TreeOptions,
  ViewOptions,
  ViewResult,
  SearchOptions,
  SearchMatch,
  ApplyEditsOptions,
  ApplyEditsResponse,
  DirectoryEntry,
} from '../files.js';
import { WorkspaceNotImplementedError } from '../errors.js';

export class HttpFiles implements WorkspaceFiles {
  async tree(_options?: TreeOptions): Promise<DirectoryEntry[]> {
    throw new WorkspaceNotImplementedError('files.tree');
  }
  async view(_options: ViewOptions): Promise<ViewResult> {
    throw new WorkspaceNotImplementedError('files.view');
  }
  async search(_options: SearchOptions): Promise<SearchMatch[]> {
    throw new WorkspaceNotImplementedError('files.search');
  }
  async applyEdits(_options: ApplyEditsOptions): Promise<ApplyEditsResponse> {
    throw new WorkspaceNotImplementedError('files.applyEdits');
  }
}
