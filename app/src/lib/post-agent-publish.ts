import { PublishErrorCode } from '@airo/shared/publish';

export function url(agentUrl: string, appId: string): string {
  return `${agentUrl}/apps/${appId}/publish`;
}

export function body(publishedUrl: string | null | undefined): string {
  return JSON.stringify({ publishedUrl: publishedUrl ?? null });
}

function init(token: string, publishedUrl: string | null | undefined): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body(publishedUrl),
  };
}

export async function post(
  agentUrl: string,
  appId: string,
  token: string,
  publishedUrl: string | null | undefined,
): Promise<Response> {
  return fetch(url(agentUrl, appId), init(token, publishedUrl));
}

export async function postWithStaleRetry(options: {
  agentUrl: string;
  appId: string;
  token: string;
  publishedUrl: string | null | undefined;
  refreshToken: () => Promise<{ token: string }>;
}): Promise<{ response: Response; parsedBody: Record<string, unknown> | null }> {
  const publishUrl = url(options.agentUrl, options.appId);
  let response = await fetch(publishUrl, init(options.token, options.publishedUrl));

  let parsedBody: Record<string, unknown> | null = null;
  if (!response.ok) {
    parsedBody = await response.json().catch(function parseError() {
      return {};
    });
  }

  if (response.status === 401 && parsedBody?.code === PublishErrorCode.TokenStale) {
    const retryToken = await options.refreshToken();
    response = await fetch(publishUrl, init(retryToken.token, options.publishedUrl));
    parsedBody = !response.ok
      ? await response.json().catch(function parseRetryError() {
        return {};
      })
      : null;
  }

  return { response, parsedBody };
}
