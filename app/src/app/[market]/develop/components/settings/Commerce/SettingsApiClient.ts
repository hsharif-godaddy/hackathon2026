class CommerceSettingsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly settingPath: string
  ) {
    super(message);
    this.name = 'CommerceSettingsApiError';
  }
}

export function localSettingsApiPath(storeId: string, settingPath: string) {
  const normalizedPath = settingPath.replace(/^\/+/, '');
  const encodedPath = normalizedPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  return `/api/commerce/settings/${encodeURIComponent(storeId)}/${encodedPath}`;
}

function queryStringForSettingsApi() {
  if (typeof window === 'undefined') return '';

  const fixtureScenario = new URLSearchParams(window.location.search).get(
    'settingsFixtureScenario'
  );
  return fixtureScenario ? `?settingsFixtureScenario=${encodeURIComponent(fixtureScenario)}` : '';
}

export async function fetchSettingsApi<T>(
  storeId: string,
  settingPath: string,
  signal?: AbortSignal
): Promise<T | null> {
  const response = await fetch(
    `${localSettingsApiPath(storeId, settingPath)}${queryStringForSettingsApi()}`,
    {
      headers: { Accept: 'application/json' },
      signal,
    }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = `Failed to fetch Commerce settings ${settingPath} (${response.status})`;

    if (body) {
      try {
        const problem = JSON.parse(body) as { title?: unknown; detail?: unknown };
        const title = typeof problem.title === 'string' ? problem.title : undefined;
        const detail = typeof problem.detail === 'string' ? problem.detail : undefined;
        message = [title, detail].filter(Boolean).join(' ') || message;
      } catch {
        message = `${message}: ${body.slice(0, 240)}`;
      }
    }

    throw new CommerceSettingsApiError(message, response.status, settingPath);
  }

  return response.json() as Promise<T>;
}
