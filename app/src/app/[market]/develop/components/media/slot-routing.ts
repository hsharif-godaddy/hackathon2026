/**
 * Derive the preview route from a media slot path.
 * Slot paths encode their page: "pages/home/hero" → "/", "pages/about/hero" → "/about",
 * "projects/foo" → "/projects". Returns null for layout/logo slots (present on all pages).
 */
export function getRouteForSlot(slotPath: string): string | null {
  if (slotPath.startsWith('pages/home/')) return '/'
  if (slotPath.startsWith('pages/')) {
    // "pages/about/hero" → "/about", "pages/blog/post/hero" → "/blog/post"
    const parts = slotPath.split('/')
    // Slots always have at least 3 segments (pages/<route>/<slotName>).
    // A 2-segment "pages/x" would be malformed — treat as home.
    if (parts.length < 3) return '/'
    // Everything between "pages/" and the last segment (the slot name) is the route
    return `/${parts.slice(1, -1).join('/')}`
  }
  // Component-level slots like "projects/foo" map to "/<first-segment>"
  if (!slotPath.startsWith('logo/') && !slotPath.startsWith('layouts/') && !slotPath.startsWith('components/')) {
    const parts = slotPath.split('/')
    return `/${parts[0]}`
  }
  // Logo/layout slots are on every page — no navigation needed
  return null
}
