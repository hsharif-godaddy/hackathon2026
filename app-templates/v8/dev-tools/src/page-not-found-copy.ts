export const PAGE_NOT_FOUND_TITLE = "This page isn't built yet";

export function formatPageNameFromPathname(pathname: string): string {
  const rawLastSegment = pathname.split('/').filter(Boolean).pop();
  if (!rawLastSegment) {
    return 'This page';
  }

  let lastSegment = rawLastSegment;
  try {
    lastSegment = decodeURIComponent(rawLastSegment);
  } catch {
    // Ignore malformed URI sequences and fall back to the raw segment.
  }

  return lastSegment
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getPageNotFoundMessage(pageName: string, isBusy: boolean): string {
  if (isBusy) {
    const pageLabel = pageName === 'This page' ? 'this page' : pageName;
    return `Airo's finishing another task. Check back when it's done to build ${pageLabel}.`;
  }
  return `${pageName} is planned for your project. Ready to build it now?`;
}
