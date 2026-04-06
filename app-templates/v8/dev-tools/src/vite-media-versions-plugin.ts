import { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_FILENAME = 'airo-media.json';
const VIRTUAL_MODULE_ID = 'virtual:media-versions';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Vite plugin that watches airo-media.json and extracts slot version data
 * (lastUpdated timestamps) for cache-busting. Pushes updates to the browser
 * via HMR WebSocket. Provides a virtual module that dev-tools can import to
 * get the current version map and subscribe to updates.
 */
export function mediaVersionsPlugin(): Plugin {
  let manifestPath = '';
  let currentVersions: Record<string, string> = {};

  function extractVersions(): Record<string, string> {
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const versions: Record<string, string> = {};
        for (const [slotName, slot] of Object.entries(manifest)) {
          const s = slot as { lastUpdated?: string };
          if (s.lastUpdated) {
            versions[slotName] = String(new Date(s.lastUpdated).getTime());
          }
        }
        return versions;
      }
    } catch {
      // File may be mid-write or malformed
    }
    return {};
  }

  function startWatching(server: { ws: { send: (event: string, data: unknown) => void }; httpServer?: { on: (event: string, cb: () => void) => void } | null }) {
    try {
      const watcher = fs.watch(manifestPath, () => {
        // Small delay to ensure atomic rename is complete
        setTimeout(() => {
          const newVersions = extractVersions();
          if (JSON.stringify(newVersions) !== JSON.stringify(currentVersions)) {
            currentVersions = newVersions;
            server.ws.send('media-versions-update', { versions: currentVersions });
          }
        }, 50);
      });
      server.httpServer?.on('close', () => watcher.close());
    } catch {
      // File doesn't exist yet (fresh app) — watch the directory for its creation.
      // Don't rely on filename param (unreliable across platforms), use existsSync instead.
      const dirWatcher = fs.watch(path.dirname(manifestPath), () => {
        if (fs.existsSync(manifestPath)) {
          dirWatcher.close();
          currentVersions = extractVersions();
          server.ws.send('media-versions-update', { versions: currentVersions });
          startWatching(server);
        }
      });
      server.httpServer?.on('close', () => dirWatcher.close());
    }
  }

  return {
    name: 'media-versions',
    apply: 'serve',

    configureServer(server) {
      manifestPath = path.join(server.config.root, MANIFEST_FILENAME);
      currentVersions = extractVersions();
      startWatching(server);
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
      return null;
    },

    load(id: string) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return `
          let versions = ${JSON.stringify(currentVersions)};
          const listeners = [];

          export function getVersions() {
            return versions;
          }

          export function onVersionsUpdate(cb) {
            listeners.push(cb);
            return () => {
              const idx = listeners.indexOf(cb);
              if (idx >= 0) listeners.splice(idx, 1);
            };
          }

          if (import.meta.hot) {
            import.meta.hot.on('media-versions-update', (data) => {
              versions = data.versions;
              listeners.forEach(cb => cb(versions));
            });
          }
        `;
      }
      return null;
    },
  };
}
