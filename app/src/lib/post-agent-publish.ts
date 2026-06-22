import { PublishErrorCode } from '@airo/shared/publish';

export function url(agentUrl: string, appId: string): string {
  return `${agentUrl}/apps/${appId}/publish`;
}

export function body(publishedUrl: string | null | undefined, async?: boolean): string {
  return JSON.stringify({ publishedUrl: publishedUrl ?? null, ...(async ? { async: true } : {}) });
}

function init(token: string, publishedUrl: string | null | undefined, async?: boolean): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body(publishedUrl, async),
  };
}

export async function post(
  agentUrl: string,
  appId: string,
  token: string,
  publishedUrl: string | null | undefined,
  async?: boolean,
): Promise<Response> {
  return fetch(url(agentUrl, appId), init(token, publishedUrl, async));
}

export async function postWithStaleRetry(options: {
  agentUrl: string;
  appId: string;
  token: string;
  publishedUrl: string | null | undefined;
  refreshToken: () => Promise<{ token: string }>;
  async?: boolean;
}): Promise<{ response: Response; parsedBody: Record<string, unknown> | null }> {
  const publishUrl = url(options.agentUrl, options.appId);
  let response = await fetch(publishUrl, init(options.token, options.publishedUrl, options.async));

  let parsedBody: Record<string, unknown> | null = null;
  if (!response.ok) {
    parsedBody = await response.json().catch(function parseError() {
      return {};
    });
  }

  if (response.status === 401 && parsedBody?.code === PublishErrorCode.TokenStale) {
    const retryToken = await options.refreshToken();
    response = await fetch(publishUrl, init(retryToken.token, options.publishedUrl, options.async));
    parsedBody = !response.ok
      ? await response.json().catch(function parseRetryError() {
        return {};
      })
      : null;
  }

  return { response, parsedBody };
}
