import type {
  WorkspaceArtifacts,
  ArtifactRef,
  CreateSourceBundleOptions,
  UploadOptions,
} from '../artifacts.js';
import { WorkspaceNotImplementedError } from '../errors.js';

export class HttpArtifacts implements WorkspaceArtifacts {
  async createSourceBundle(_options?: CreateSourceBundleOptions): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError('artifacts.createSourceBundle');
  }
  async createBuildBundle(): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError('artifacts.createBuildBundle');
  }
  async upload(_options: UploadOptions): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError('artifacts.upload');
  }
  async get(_artifactId: string): Promise<ArtifactRef> {
    throw new WorkspaceNotImplementedError('artifacts.get');
  }
  async download(_artifactId: string): Promise<Uint8Array> {
    throw new WorkspaceNotImplementedError('artifacts.download');
  }
}
