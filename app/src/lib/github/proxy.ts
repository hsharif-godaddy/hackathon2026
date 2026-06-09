import { GITHUB_API_VERSION } from './constants';

export interface ProxyOptions {
  method?: string;
  body?: string;
  params?: Record<string, string>;
}

export async function proxy(
  path: string,
  token: string,
  options?: ProxyOptions,
): Promise<Response> {
  const url = new URL(`https://api.github.com${path}`);
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  return fetch(url.toString(), {
    method: options?.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'airo-builder-bff',
    },
    body: options?.body,
  });
}
