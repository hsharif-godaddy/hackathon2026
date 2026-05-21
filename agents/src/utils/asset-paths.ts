/**
 * Normalize a source-site asset filesystem path to its public URL form.
 *
 * Inputs are typed `${.source-site/assets}/<...>` (filesystem-relative); outputs
 * are `/assets/<...>` (servable from the rebuilt app's public root). Backslashes
 * are converted to forward slashes for paths constructed on Windows agents.
 */
export function normalizeAssetPath(localPath: string): string {
  return localPath
    .replace(/\\/g, '/')
    .replace(/^\.source-site\/assets\//, '/assets/');
}
