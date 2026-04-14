import { Plugin } from 'vite';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

const ERROR_RE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const TS_EXT_RE = /\.[mc]?tsx?$/;
const DEBOUNCE_MS = 1000;

/**
 * Vite plugin that runs `tsc --noEmit` on-demand after TypeScript file changes.
 *
 * Instead of a persistent tsc --watch process (which consumes ~50-80MB RSS),
 * this spawns a one-shot tsc check after a debounced file save. The check
 * takes 2-5s and exits, keeping idle memory at zero.
 *
 * Errors are sent to the browser via HMR:
 * - 'tsc-error': { errors: TscError[] } when type errors are found
 * - 'tsc-error-resolved': {} when errors are cleared after a previous failure
 *
 * error-client.ts handles these events and forwards them to the builder app,
 * which auto-sends them to the AI agent for fixing.
 */
export function tscWatchPlugin(): Plugin {
  let initialized = false;
  let tscProcess: ChildProcess | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let hadErrors = false;

  return {
    name: 'tsc-on-save',
    apply: 'serve',

    configureServer(server) {
      // Guard against Vite 6 Environment API calling configureServer multiple times
      if (initialized) return;
      initialized = true;

      const root = server.config.root;
      const tscBin = path.join(root, 'node_modules', '.bin', 'tsc');

      function runTscCheck() {
        // Kill any in-flight check (superseded by newer save)
        if (tscProcess) {
          tscProcess.kill();
          tscProcess = null;
        }

        const proc = spawn(tscBin, ['--noEmit', '--pretty', 'false'], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        tscProcess = proc;

        const errors: TscError[] = [];
        let stdout = '';

        proc.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          const lines = stdout.split('\n');
          // Keep last incomplete line in buffer
          stdout = lines.pop() || '';

          for (const line of lines) {
            const match = line.match(ERROR_RE);
            if (match) {
              errors.push({
                file: match[1],
                line: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                code: match[4],
                message: match[5],
              });
            }
          }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg) console.error('[tsc]', msg);
        });

        proc.on('error', (err) => {
          console.error('[tsc] Failed to spawn:', err.message);
          tscProcess = null;
        });

        proc.on('exit', () => {
          // Superseded by a newer check — discard partial results
          if (tscProcess !== proc) return;
          tscProcess = null;

          // Process remaining buffered output
          if (stdout.trim()) {
            const match = stdout.trim().match(ERROR_RE);
            if (match) {
              errors.push({
                file: match[1],
                line: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                code: match[4],
                message: match[5],
              });
            }
          }

          if (errors.length > 0) {
            hadErrors = true;
            server.hot.send('tsc-error', { errors });
          } else if (hadErrors) {
            hadErrors = false;
            server.hot.send('tsc-error-resolved', {});
          }
        });
      }

      function scheduleCheck(filePath: string) {
        if (!TS_EXT_RE.test(filePath)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runTscCheck, DEBOUNCE_MS);
      }

      server.watcher.on('change', scheduleCheck);
      server.watcher.on('add', scheduleCheck);

      // Cleanup on server close
      server.httpServer?.on('close', () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (tscProcess) {
          tscProcess.kill();
          tscProcess = null;
        }
      });
    },
  };
}
