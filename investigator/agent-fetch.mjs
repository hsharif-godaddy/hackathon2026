/**
 * Agents-service fetchers for the investigator Lambda.
 *
 * Uses a pre-minted agent JWT (see agent-jwt.mjs) to pull the two artifacts the
 * debug-console AI Agent panel surfaces, against the same agents endpoints:
 *   - App code:      GET {agentUrl}/apps/{appId}/zip        → streamed to disk + unzipped
 *   - Conversations: GET {agentUrl}/agent/conversations/{appId}
 *                    GET {agentUrl}/agent/conversations/{appId}/{conversationId}  (recent N)
 *
 * Both entry points SOFT-FAIL: every network error, non-200 response, or unzip
 * failure resolves to `{ ok: false, error }` rather than throwing, so the
 * handler can degrade to a logs-only investigation. Stdlib only — no new deps.
 * `unzip` is a system binary provided by the container image (Dockerfile M3.1).
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Join a base URL and path without producing a double slash.
 * @param {string} base
 * @param {string} path leading-slash optional
 * @returns {string}
 */
function joinUrl(base, path) {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * Normalize a thrown value into a string message.
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Unzip a downloaded archive into an output directory. Split out so it can be
 * tested directly and so failures stay isolated from the download path.
 * @param {string} zipPath
 * @param {string} outDir
 * @returns {Promise<void>}
 */
export async function _unzip(zipPath, outDir) {
  // -o overwrite without prompting, -q quiet, -d target dir.
  await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', outDir]);
}

/**
 * Download the app code zip and extract it.
 * @param {{ agentUrl: string; appId: string; token: string; destDir: string }} options
 * @returns {Promise<{ ok: true; dir: string } | { ok: false; error: string }>}
 */
export async function fetchAppZip({ agentUrl, appId, token, destDir }) {
  const url = joinUrl(agentUrl, `apps/${encodeURIComponent(appId)}/zip`);
  const zipPath = join(destDir, 'app.zip');
  const outDir = join(destDir, 'app');

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    });

    if (!res.ok || !res.body) {
      return { ok: false, error: `app zip download failed: HTTP ${res.status}` };
    }

    mkdirSync(destDir, { recursive: true });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

    mkdirSync(outDir, { recursive: true });
    await _unzip(zipPath, outDir);

    return { ok: true, dir: outDir };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Fetch the conversation list and, for the most recent `detailLimit`, their
 * details. A failed individual detail fetch is tolerated (left undefined); only
 * a failed list fetch soft-fails the whole call.
 * @param {{ agentUrl: string; appId: string; token: string; detailLimit?: number }} options
 * @returns {Promise<{ ok: true; conversations: Array<object> } | { ok: false; error: string }>}
 */
export async function fetchConversations({ agentUrl, appId, token, detailLimit = 5 }) {
  const authHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const listUrl = joinUrl(agentUrl, `agent/conversations/${encodeURIComponent(appId)}`);

  let conversations;
  try {
    const res = await fetch(listUrl, { method: 'GET', headers: authHeaders });
    if (!res.ok) {
      return { ok: false, error: `conversation list failed: HTTP ${res.status}` };
    }
    conversations = await res.json();
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  if (!Array.isArray(conversations)) {
    // Tolerate the common wrapper { conversations: [...] }; otherwise the body
    // is unusable (null / unknown shape). Treat unusable as a FETCH FAILURE so
    // the run is marked degraded (the coverage guard caps verdict confidence)
    // and the skill is never handed a non-iterable conversations.json.
    if (conversations && Array.isArray(conversations.conversations)) {
      conversations = conversations.conversations;
    } else {
      console.warn('[investigator] agent.conversations.unexpected_shape — treating as unavailable', {
        appId,
        type: conversations === null ? 'null' : typeof conversations,
      });
      return { ok: false, error: 'unexpected conversation shape' };
    }
  }

  const detailCount = Math.max(0, Math.min(detailLimit, conversations.length));
  for (let i = 0; i < detailCount; i += 1) {
    const conversation = conversations[i];
    const id = conversation && (conversation.id ?? conversation.conversationId);
    if (!id) continue;
    const detailUrl = joinUrl(
      agentUrl,
      `agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(id)}`,
    );
    try {
      const res = await fetch(detailUrl, { method: 'GET', headers: authHeaders });
      if (!res.ok) continue;
      conversation.detail = await res.json();
    } catch {
      // Tolerate a single bad detail fetch; the list itself is still useful.
    }
  }

  return { ok: true, conversations };
}
