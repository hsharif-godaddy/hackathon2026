import { basename, dirname, normalize, sep } from 'path';

// Local dev runs agents on the host and preview in Docker. When SCREENSHOT_DIR is
// not set, store screenshots in the app's agent directory so they don't end up in
// the preview app workspace/container path.
export function resolveScreenshotDir(appPath: string): string {
  if (process.env.SCREENSHOT_DIR) {
    return process.env.SCREENSHOT_DIR;
  }

  const normalizedAppPath = normalize(appPath);

  if (basename(normalizedAppPath) === 'preview') {
    return `${dirname(normalizedAppPath)}${sep}agent`;
  }

  return normalizedAppPath;
}
