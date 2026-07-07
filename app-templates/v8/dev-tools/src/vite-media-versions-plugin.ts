import { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_FILENAME = 'airo-media.json';

/**
 * Vite plugin that watches airo-media.json and pushes slot version data
 * (lastUpdated timestamps) to the browser via HMR WebSocket for cache-busting.
 * Also serves /airo-media.json from the project root so dev-tools can fetch
 * the initial manifest directly.
 */
export function mediaVersionsPlugin(): Plugin {
  let manifestPath = '';
  let currentVersions: Record<string, string> = {};
  let currentMediaTypes: Record<string, string> = {};
  let currentCaptions: Record<string, string> = {};

  function extractData(): { versions: Record<string, string>; mediaTypes: Record<string, string>; captions: Record<string, string> } {
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const versions: Record<string, string> = {};
        const mediaTypes: Record<string, string> = {};
        const captions: Record<string, string> = {};
        for (const [slotName, slot] of Object.entries(manifest)) {
          const s = slot as { lastUpdated?: string; mediaType?: string; caption?: string };
          if (s.lastUpdated) {
            versions[slotName] = String(new Date(s.lastUpdated).getTime());
          }
          if (s.mediaType) {
            mediaTypes[slotName] = s.mediaType;
          }
          if (s.caption) {
            captions[slotName] = s.caption;
          }
        }
        return { versions, mediaTypes, captions };
      }
    } catch {
      // File may be mid-write or malformed
    }
    return { versions: {}, mediaTypes: {}, captions: {} };
  }

  function startWatching(server: { ws: { send: (event: string, data: unknown) => void }; httpServer?: { on: (event: string, cb: () => void) => void } | null }) {
    try {
      const watcher = fs.watch(manifestPath, () => {
        // Small delay to ensure atomic rename is complete
        setTimeout(() => {
          const { versions, mediaTypes, captions } = extractData();
          if (JSON.stringify(versions) !== JSON.stringify(currentVersions) ||
              JSON.stringify(mediaTypes) !== JSON.stringify(currentMediaTypes) ||
              JSON.stringify(captions) !== JSON.stringify(currentCaptions)) {
            currentVersions = versions;
            currentMediaTypes = mediaTypes;
            currentCaptions = captions;
            server.ws.send('media-versions-update', { versions: currentVersions, mediaTypes: currentMediaTypes, captions: currentCaptions });
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
          const data = extractData();
          currentVersions = data.versions;
          currentMediaTypes = data.mediaTypes;
          currentCaptions = data.captions;
          server.ws.send('media-versions-update', { versions: currentVersions, mediaTypes: currentMediaTypes, captions: currentCaptions });
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
      const data = extractData();
      currentVersions = data.versions;
      currentMediaTypes = data.mediaTypes;
      currentCaptions = data.captions;
      startWatching(server);

      // Serve /airo-media.json from project root so dev-tools can fetch it
      // (Vite only auto-serves public/ at root URLs; the manifest lives at project root)
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' + MANIFEST_FILENAME) {
          try {
            if (fs.existsSync(manifestPath)) {
              const content = fs.readFileSync(manifestPath, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(content);
              return;
            }
          } catch {
            // Fall through to 404
          }
          res.statusCode = 404;
          res.end('{}');
          return;
        }
        next();
      });
    },
  };
}
