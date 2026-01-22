import { config } from '../config';
import { BaseClient } from './base-client';
import { GettySearchParams, GettyAPIResponse } from '../types';

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
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const gettyUrl = `${config.getty.upstream}/v1/search?${queryString}`;

      return this.makeRequest(gettyUrl, requestId, 'GET', undefined, {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      });
    });
  }

  async videoSearch(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const gettyUrl = `${config.getty.upstream}/v1/videos/search?${queryString}`;

      return this.makeRequest(gettyUrl, requestId, 'GET', undefined, {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      });
    });
  }

  async videoUpload(videoId: string, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    return this.executeWithTiming(async () => {
      const gettyUrl = `${config.getty.upstream}/v1/videos/upload`;

      return this.makeRequest(gettyUrl, requestId, 'POST', JSON.stringify({ id: videoId }), {
        'x-app-key': config.getty.appKey,
        'User-Agent': config.getty.userAgent
      });
    });
  }
}

export default new GettyClient();
