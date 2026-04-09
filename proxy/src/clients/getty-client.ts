import { config } from '../config/index.js';
import { BaseClient, BaseAPIResponse } from './base-client.js';
import { GettySearchParams, GettyAPIResponse } from '../types/index.js';

/**
 * Build a query string that correctly handles array values as repeated params.
 * Express parses ?orientations=horizontal&orientations=square into an array,
 * but URLSearchParams(obj) would join arrays with commas, which Getty rejects.
 */
export function buildQueryString(params: GettySearchParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        qs.append(key, String(item));
      }
    } else {
      qs.append(key, String(value));
    }
  }
  return qs.toString();
}

class GettyClient extends BaseClient {
  constructor() {
    super({
      serviceName: 'Getty',
      ssoHost: 'sso.godaddy.com',
      defaultRetries: 2
    });
  }

  async search(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const queryString = buildQueryString(params);
      const gettyUrl = `${config.getty.upstream}/v1/search?${queryString}`;

      return (await this.makeRequest(gettyUrl, requestId, 'GET', undefined, {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      })) as BaseAPIResponse;
    });
  }

  async videoSearch(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const queryString = buildQueryString(params);
      const gettyUrl = `${config.getty.upstream}/v1/videos/search?${queryString}`;

      return (await this.makeRequest(gettyUrl, requestId, 'GET', undefined, {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      })) as BaseAPIResponse;
    });
  }

  async videoUpload(videoId: string, requestId: string = 'unknown', reportUsage: boolean = false): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const params = new URLSearchParams();
      if (reportUsage) {
        params.set('reportUsage', 'true');
      }
      const queryString = params.toString();
      const gettyUrl = queryString
        ? `${config.getty.upstream}/v1/videos/upload?${queryString}`
        : `${config.getty.upstream}/v1/videos/upload`;

      return (await this.makeRequest(gettyUrl, requestId, 'POST', JSON.stringify({ id: videoId }), {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      })) as BaseAPIResponse;
    });
  }

  async upload(ids: string[], reportUsage: boolean = false, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const params = new URLSearchParams();
      if (reportUsage) {
        params.set('reportUsage', 'true');
      }
      const queryString = params.toString();
      const gettyUrl = queryString
        ? `${config.getty.upstream}/v1/upload?${queryString}`
        : `${config.getty.upstream}/v1/upload`;

      return this.makeRequest(gettyUrl, requestId, 'POST', JSON.stringify({ ids }), {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      });
    });
  }

  async reportUsage(ids: string[], options?: { skipTagging?: boolean; mediaType?: string }, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const params = new URLSearchParams();
      if (options?.skipTagging) {
        params.set('skipTagging', 'true');
      }
      if (options?.mediaType) {
        params.set('mediaType', options.mediaType);
      }
      const queryString = params.toString();
      const gettyUrl = queryString
        ? `${config.getty.upstream}/v1/usage?${queryString}`
        : `${config.getty.upstream}/v1/usage`;

      return this.makeRequest(gettyUrl, requestId, 'PUT', JSON.stringify({ ids }), {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      });
    });
  }
}

export default new GettyClient();
