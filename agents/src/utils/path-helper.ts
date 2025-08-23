/**
 * Path utilities for handling Docker path translation
 */

/**
 * Translate Docker container paths to relative paths for the agent environment.
 * Docker containers use /app/ as root, but agents use /tmp/apps/appid/ or similar.
 * 
 * @param path - The file path that might be a Docker absolute path
 * @returns The normalized relative path
 */
export function translateDockerPath(path: string): string {
  // Translate Docker paths to relative paths
  let normalizedPath = path;
  
  if (path.startsWith('/app/')) {
    // Strip /app/ prefix to make it relative
    normalizedPath = path.slice(5); // Remove '/app/' (5 characters)
    console.log(`🔄 Translated Docker path: ${path} → ${normalizedPath}`);
  } else if (path.startsWith('/')) {
    // Handle other absolute paths by making them relative
    // This shouldn't normally happen, but provides a fallback
    normalizedPath = path.slice(1);
    console.log(`⚠️ Converting absolute path to relative: ${path} → ${normalizedPath}`);
  }
  
  return normalizedPath;
}