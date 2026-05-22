/**
 * Conversation Export CLI
 *
 * Streams the markdown export of an app's conversations from the prod
 * debug-console (https://console.airo-builder.godaddy.com). Operators
 * authenticate with a JOMAX token; the debug-console boundary handles
 * JOMAX, the agents service sees only its normal internal-service auth.
 *
 * For the dev environment, edit BASE_URL to
 *   https://console.airo-builder.test-godaddy.com
 *
 * Usage:
 *   JOMAX_TOKEN=<token> pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full]
 *   pnpm tsx scripts/export-chat.ts <appId> --token=<token> [--detail=summary|full]
 *
 * Output is written to stdout. Pipe to a file:
 *   ... | tee conversations.md
 */

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE_URL = 'https://console.airo-builder.godaddy.com';

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith('--'));
const detailArg = args.find((a) => a.startsWith('--detail='));
const tokenArg = args.find((a) => a.startsWith('--token='));

if (!appId) {
  console.error('Usage: pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full] [--token=<jomax>]');
  process.exit(1);
}

const detail = (detailArg?.split('=')[1] as 'summary' | 'full' | undefined) ?? 'full';
if (detail !== 'summary' && detail !== 'full') {
  console.error('Error: --detail must be "summary" or "full"');
  process.exit(1);
}

const token = tokenArg?.split('=')[1] ?? process.env.JOMAX_TOKEN;
if (!token) {
  console.error('Error: provide a JOMAX token via JOMAX_TOKEN env or --token=<value>');
  process.exit(1);
}

const url = `${BASE_URL}/api/agent/conversations-export/${encodeURIComponent(appId)}?format=markdown&detail=${detail}`;

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!response.ok) {
  const text = await response.text().catch(() => '');
  console.error(`Export failed (HTTP ${response.status}): ${text || response.statusText}`);
  process.exit(1);
}

if (!response.body) {
  console.error('Export returned no body');
  process.exit(1);
}

await pipeline(Readable.fromWeb(response.body as any), process.stdout);
