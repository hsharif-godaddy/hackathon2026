import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { parseRelease, type ParsedRelease } from '@/lib/releases-github';
import { routeCached } from '@/lib/route-cache';

type ReleasesPayload = ParsedRelease & { past_releases: ParsedRelease[] };

const RELEASES_GITHUB = { owner: 'gdcorp-partners', repo: 'airo-app-builder' } as const;

async function ghGetJson(path: string, token: string): Promise<unknown> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

export const GET = withAuth(async () => {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: 'GitHub releases not configured (set GITHUB_TOKEN)' },
      { status: 503 },
    );
  }
  const { owner, repo } = RELEASES_GITHUB;
  const pathPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    const cacheKey = `github_releases:${owner}/${repo}`;
    const data = await routeCached(cacheKey, 120_000, async () => {
      const latestRaw = (await ghGetJson(`${pathPrefix}/releases/latest`, token)) as Record<
        string,
        unknown
      >;
      const base = parseRelease(latestRaw);
      const payload: ReleasesPayload = { ...base, past_releases: [] };
      const allRaw = await ghGetJson(`${pathPrefix}/releases?per_page=5`, token);
      if (Array.isArray(allRaw)) {
        payload.past_releases = allRaw.map((r) => parseRelease(r as Record<string, unknown>));
      }
      return payload;
    });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('api.releases.fetch.failed', { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
