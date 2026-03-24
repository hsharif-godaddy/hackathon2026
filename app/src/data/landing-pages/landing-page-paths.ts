import { LANDING_PREFIX } from '@/data/landing-pages/constants';
import lookup from '@/data/landing-pages/lookup.json';

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

const LANDING_PAGE_PATHS = new Set(
  Object.keys(lookup.routes).map((routeKey) => `/${LANDING_PREFIX}/${routeKey}`)
);

export function isLandingPagePathname(pathname: string): boolean {
  return LANDING_PAGE_PATHS.has(normalizePathname(pathname));
}
