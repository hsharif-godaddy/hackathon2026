const CLICKABLE_SELECTOR = "a, button, [role='button']";

export type FollowTarget =
  | { kind: "link"; href: string; displayUrl: string }
  | { kind: "button" };

export function resolveClickableElement(element: HTMLElement): HTMLElement | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "a" || tag === "button" || element.getAttribute("role") === "button") {
    return element;
  }
  if (element.onclick || element.hasAttribute("onclick")) {
    return element;
  }
  return element.closest(CLICKABLE_SELECTOR) as HTMLElement | null;
}

/** Human-readable label for the link follow bar. Internal pages show a friendly
 *  name (e.g. "About Us"); short external URLs show host+path; long external
 *  URLs show domain + first path segment (e.g. "youtube.com · /watch"). */
export function formatLinkDisplayUrl(href: string): string {
  try {
    const url = new URL(href, window.location.origin);
    // Internal page: show friendly name instead of full URL
    if (url.origin === window.location.origin) {
      const path = url.pathname;
      if (path === "/" && !url.hash) return "Home";
      const segments = path.split("/").filter(Boolean);
      const last = segments[segments.length - 1] ?? (url.hash ? url.hash.slice(1) : "Home");
      return decodeURIComponent(last)
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    const host = url.host.replace(/^www\./, "");
    const compact = `${host}${url.pathname}${url.search}${url.hash}`;
    const maxLength = 36;
    if (compact.length <= maxLength) return compact;
    // Long external URLs: show domain + first path segment for readability
    const firstSegment = url.pathname.split("/").filter(Boolean)[0];
    return firstSegment ? `${host} · /${firstSegment}` : host;
  } catch {
    if (href.length <= 36) return href;
    return `${href.slice(0, 35)}…`;
  }
}

export function resolveFollowTarget(element: HTMLElement): FollowTarget | null {
  const clickable = resolveClickableElement(element);
  if (!clickable) return null;

  const anchor =
    clickable.tagName.toLowerCase() === "a"
      ? (clickable as HTMLAnchorElement)
      : (clickable.closest("a") as HTMLAnchorElement | null);

  if (anchor?.getAttribute("href")) {
    return {
      kind: "link",
      href: anchor.href,
      displayUrl: formatLinkDisplayUrl(anchor.href),
    };
  }

  const tag = clickable.tagName.toLowerCase();
  if (
    tag === "button"
    || clickable.getAttribute("role") === "button"
    || clickable.onclick
    || clickable.hasAttribute("onclick")
  ) {
    return { kind: "button" };
  }

  return null;
}

/**
 * Navigate or activate a link/button from Edit mode. Uses direct navigation for
 * anchors so edit-mode click interceptors cannot cancel the follow action.
 */
export function followClickableElement(element: HTMLElement): boolean {
  const clickable = resolveClickableElement(element);
  if (!clickable) return false;

  const anchor =
    clickable.tagName.toLowerCase() === "a"
      ? (clickable as HTMLAnchorElement)
      : (clickable.closest("a") as HTMLAnchorElement | null);

  if (anchor?.getAttribute("href")) {
    if (anchor.target === "_blank") {
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign(anchor.href);
    }
    return true;
  }

  clickable.click();
  return true;
}
