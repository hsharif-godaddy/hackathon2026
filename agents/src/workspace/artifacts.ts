export type ArtifactKind = 'source-bundle' | 'build-bundle' | 'uploaded';

export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactKind;
  size: number;
  sha256: string;
  createdAt: Date;
}

export interface CreateSourceBundleOptions {
  includeNodeModules?: boolean;
  includeGit?: boolean;
}

export interface UploadOptions {
  content: Uint8Array;
  filename: string;
  mediaType?: string;
}

export interface WorkspaceArtifacts {
  createSourceBundle(options?: CreateSourceBundleOptions): Promise<ArtifactRef>;
  createBuildBundle(): Promise<ArtifactRef>;
  upload(options: UploadOptions): Promise<ArtifactRef>;
  get(artifactId: string): Promise<ArtifactRef>;
  download(artifactId: string): Promise<Uint8Array>;
}
