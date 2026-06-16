export function isBuilderPagePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname.includes('/develop/') || pathname.includes('/commander/')
}
