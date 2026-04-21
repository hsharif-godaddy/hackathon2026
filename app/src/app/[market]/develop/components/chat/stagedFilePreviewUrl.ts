/**
 * Reuse one object URL per staged File so React Strict Mode (dev) double-invocation
 * of state updaters does not create orphan blob URLs. Revoke when the file leaves staging.
 */
const previewUrlByFile = new WeakMap<File, string>()

export function getStagedFilePreviewUrl(file: File): string {
  if (!file.type.startsWith('image/')) {
    return ''
  }
  let url = previewUrlByFile.get(file)
  if (!url) {
    url = URL.createObjectURL(file)
    previewUrlByFile.set(file, url)
  }
  return url
}

export function revokeStagedFilePreviewIfCached(file: File): void {
  const url = previewUrlByFile.get(file)
  if (url) {
    URL.revokeObjectURL(url)
    previewUrlByFile.delete(file)
  }
}
