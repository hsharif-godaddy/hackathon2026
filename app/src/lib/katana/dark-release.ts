import { KATANA_VERSION_COOKIE, sanitizeKatanaVersion } from '@/lib/mgmt-airo/katana-version';

/**
 * Client-side helpers for Katana "dark release" mode.
 *
 * A dark-released artifact (0% traffic) is reached via a persistent `x_katana_version`
 * cookie that Katana's picker lambda sets when a request hits `?x-katana-version=<id>&cookie=1`.
 * The cookie is NOT HttpOnly, so the browser can both read it (to show which version is
 * pinned) and delete it (to exit dark-release mode).
 */

/**
 * Read and sanitize the dark-release selector from the `x_katana_version` cookie.
 * Returns `undefined` on the server, when the cookie is absent, or when the value fails
 * validation. The returned value is the artifact version/tag (e.g. the build's commit SHA).
 */
export function getDarkReleaseVersion(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const segment of document.cookie.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(`${KATANA_VERSION_COOKIE}=`)) continue;
    const raw = trimmed.slice(KATANA_VERSION_COOKIE.length + 1);
    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    return sanitizeKatanaVersion(value);
  }
  return undefined;
}

/**
 * Exit dark-release mode: delete the `x_katana_version` cookie (matching the path the
 * picker lambda set, so the host-only cookie is actually removed), strip any dark-release
 * query params so a reload can't immediately re-pin, then reload onto the live artifact.
 */
export function exitDarkRelease(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${KATANA_VERSION_COOKIE}=; path=/; max-age=0; SameSite=None; Secure`;

  const url = new URL(window.location.href);
  let changed = false;
  for (const param of ['x-katana-version', 'cookie']) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (changed) {
    window.location.replace(url.toString());
  } else {
    window.location.reload();
  }
}
