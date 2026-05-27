import JSZip from 'jszip'

function hasKitMeta(zip: JSZip): boolean {
  if (zip.files['kit-meta.json']) return true
  // macOS Finder wraps in a top-level folder — check one level deep
  return Object.keys(zip.files).some(p => p.endsWith('/kit-meta.json') && p.split('/').length === 2)
}

function detectCommonPrefix(paths: string[]): string {
  const topDirs = new Set(paths.map(p => p.split('/')[0]).filter(Boolean))
  if (topDirs.size === 1) {
    const prefix = [...topDirs][0] + '/'
    if (paths.some(p => p.startsWith(prefix) && p.length > prefix.length)) {
      return prefix
    }
  }
  return ''
}

export async function detectAppBuilderApp(data: ArrayBuffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(data)
    const allPaths = Object.keys(zip.files).filter(p => !p.startsWith('__MACOSX/'))
    const commonPrefix = detectCommonPrefix(allPaths)

    const hasFile = (name: string): boolean => !!zip.files[name] || !!zip.files[`${commonPrefix}${name}`]
    const hasDir = (name: string): boolean => {
      const prefixed = commonPrefix ? `${commonPrefix}${name}` : name
      return allPaths.some(p => p.startsWith(prefixed))
    }

    if (!hasFile('package.json')) return false
    if (!hasFile('index.html')) return false
    if (!hasDir('src/')) return false

    const hasViteConfig = hasFile('vite.config.ts') || hasFile('vite.config.js') || hasFile('vite.config.mjs')
    if (!hasViteConfig) return false

    return true
  } catch {
    return false
  }
}

export async function detectUiKit(data: ArrayBuffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(data)
    return hasKitMeta(zip)
  } catch {
    return false
  }
}
