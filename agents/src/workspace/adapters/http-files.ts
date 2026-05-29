import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceFiles,
  TreeOptions,
  TreeResult,
  ViewOptions,
  ViewResult,
  SearchOptions,
  SearchMatch,
  WriteOptions,
  WriteResult,
  EditOptions,
  EditResult,
  InsertOptions,
  InsertResult,
  DeleteOptions,
  MoveOptions,
  FileUploadOptions,
  DownloadOptions,
  DownloadResult,
} from '../files.js';

export class HttpFiles implements WorkspaceFiles {
  constructor(private readonly client: DevSupervisorClient) {}

  async tree(options?: TreeOptions): Promise<TreeResult> {
    const response = await this.client.post('/workspace/files/tree', options ?? {});
    return response as TreeResult;
  }

  async view(options: ViewOptions): Promise<ViewResult> {
    const response = await this.client.post('/workspace/files/view', options);
    return response as ViewResult;
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
    const encodedPath = options.path.split('/').map(encodeURIComponent).join('/');
    const response = await this.client.putRaw(
      `/workspace/files/upload?path=${encodedPath}`,
      options.data,
    );
    return response as WriteResult;
  }

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const encodedPath = options.path.split('/').map(encodeURIComponent).join('/');
    const response = await this.client.getRaw(
      `/workspace/files/download?path=${encodedPath}`,
    );
    return {
      data: response.data,
      contentType: response.contentType,
    };
  }
}
