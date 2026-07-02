import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import {
  collectBuffer,
  type WorkspaceFiles,
  type TreeOptions,
  type TreeResult,
  type StatOptions,
  type StatResult,
  type ViewOptions,
  type ViewResult,
  type SearchOptions,
  type SearchMatch,
  type WriteOptions,
  type WriteResult,
  type EditOptions,
  type EditResult,
  type InsertOptions,
  type InsertResult,
  type DeleteOptions,
  type MoveOptions,
  type FileUploadOptions,
  type ReadTextOptions,
  type DownloadOptions,
  type DownloadResult,
  type ArchiveOptions,
  type ArchiveResult,
} from '../files.js';

function buildDownloadUrl(options: DownloadOptions): string {
  const encodedPath: string = options.path.split('/').map(encodeURIComponent).join('/');
  let url: string = `/workspace/files/download?path=${encodedPath}`;
  if (options.root) {
    url += `&root=${encodeURIComponent(options.root)}`;
  }
  return url;
}

export class HttpFiles implements WorkspaceFiles {
  private static readonly MAX_READ_TEXT_BYTES: number = 10 * 1024 * 1024;

  constructor(private readonly client: DevSupervisorClient) {}

  async tree(options?: TreeOptions): Promise<TreeResult> {
    const response = await this.client.post('/workspace/files/tree', options ?? {});
    return response as TreeResult;
  }

  async stat(options: StatOptions): Promise<StatResult> {
    const response = await this.client.post('/workspace/files/stat', options);
    return response as StatResult;
  }

  async view(options: ViewOptions): Promise<ViewResult> {
    const { stream, headers } = await this.client.postStream(
      '/workspace/files/view',
      options,
      { Accept: '*/*' },
    );

    // Plain text body with numbered lines, metadata in headers.
    // Binary files are rejected server-side with a 422 (binary_file error).
    const content: Buffer = await collectBuffer(stream);
    const path: string = (headers['x-file-path'] as string) || options.path;
    const lines: number = parseInt((headers['x-file-lines'] as string) || '0', 10);
    const size: number = parseInt((headers['x-file-size'] as string) || '0', 10);
    const truncated: boolean = (headers['x-truncated'] as string) === 'true';

    return {
      path,
      content: content.toString('utf-8'),
      lines,
      size,
      truncated,
    };
  }

  async search(options: SearchOptions): Promise<SearchMatch[]> {
    const response = (await this.client.post('/workspace/files/search', options)) as {
      matches: SearchMatch[];
    };
    return response.matches;
  }

  async write(options: WriteOptions): Promise<WriteResult> {
    const response = await this.client.post('/workspace/files/write', options);
    return response as WriteResult;
  }

  async edit(options: EditOptions): Promise<EditResult> {
    const response = await this.client.post('/workspace/files/edit', options);
    return response as EditResult;
  }

  async insert(options: InsertOptions): Promise<InsertResult> {
    const response = await this.client.post('/workspace/files/insert', options);
    return response as InsertResult;
  }

  async delete(options: DeleteOptions): Promise<void> {
    await this.client.post('/workspace/files/delete', options);
  }

  async move(options: MoveOptions): Promise<void> {
    await this.client.post('/workspace/files/move', options);
  }

  async upload(options: FileUploadOptions): Promise<WriteResult> {
    const encodedPath: string = options.path.split('/').map(encodeURIComponent).join('/');
    let url: string = `/workspace/files/upload?path=${encodedPath}`;
    if (options.root) {
      url += `&root=${encodeURIComponent(options.root)}`;
    }
    const response = await this.client.putRaw(url, options.data);
    return response as WriteResult;
  }

  async readText(options: ReadTextOptions): Promise<string> {
    const url: string = buildDownloadUrl(options);
    const { stream, contentLength } = await this.client.getStream(url);
    if (contentLength > HttpFiles.MAX_READ_TEXT_BYTES) {
      stream.destroy();
      throw new Error(`File too large to read as text (${contentLength} bytes, max ${HttpFiles.MAX_READ_TEXT_BYTES})`);
    }
    const data: Buffer = await collectBuffer(stream);
    return data.toString('utf-8');
  }

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const url: string = buildDownloadUrl(options);
    const { stream, contentType, contentLength } = await this.client.getStream(url);
    return { stream, contentType, contentLength };
  }

  async archive(options: ArchiveOptions): Promise<ArchiveResult> {
    const { stream, contentType } = await this.client.postStream(
      '/workspace/files/archive',
      {
        root: options.root,
        dirs: options.dirs ?? [],
        files: options.files ?? [],
        prefix: options.prefix ?? '',
      },
    );
    return { stream, contentType };
  }
}
