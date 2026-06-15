import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent, fetch } from 'undici';

import type { Turn } from '../runner/transcript.js';

export const GENERATE_LOGO_TOOL = 'media-logo__generate_logo';
const LOGO_FETCH_TIMEOUT_MS = 15_000;

export function isLogoTool(name: string): boolean {
  return name.includes('media-logo') && (name.includes('generate') || name.includes('edit'));
}

interface GenerateLogoOutput {
  structuredContent?: {
    slots?: unknown;
    status?: string;
  };
}

/**
 * Normalizes a slot value from a generate_logo tool output to a full
 * /airo-assets/images/ path. Handles both the old bare format ("logo/horizontal")
 * and the new full format ("/airo-assets/images/logo/horizontal").
 */
export function toSlotPath(slot: unknown): string | null {
  if (typeof slot !== 'string' || !slot) return null;
  if (slot.startsWith('/airo-assets/')) return slot;
  return `/airo-assets/images/${slot}`;
}

/**
 * Derives a safe filename from a slot path using the full slot segments to
 * avoid collisions between slots sharing a final segment (e.g. logo/horizontal
 * and icon/horizontal both map to "horizontal" with a last-segment-only approach).
 * "/airo-assets/images/logo/horizontal" → "logo-horizontal.png"
 */
export function slotFilename(slotPath: string): string {
  const normalized = slotPath.replace(/^\/airo-assets\/images\//, '');
  return `${normalized.replace(/\//g, '-') || 'logo'}.png`;
}

/**
 * Downloads logo images produced by `generate_logo` tool calls in the trial
 * transcript and saves them under:
 *   {trialDir}/snapshots/logos/{toolCallId}/{slotName}.png
 *
 * Runs best-effort: individual fetch failures are logged and skipped without
 * throwing so the trial result is never affected.
 *
 * Only downloads from tool calls that completed (status === 'completed') or
 * have the slots field present (queued/async mode — the slots are placeholders
 * but the path is stable).
 */
export async function downloadLogoSnapshots(
  turns: Turn[],
  previewUrl: string,
  trialDir: string,
  ignoreHttpsErrors: boolean,
): Promise<void> {
  const logoToolCalls = turns
    .flatMap((t) => t.toolCalls)
    .filter((tc) => isLogoTool(tc.name) && tc.output != null);

  if (logoToolCalls.length === 0) return;

  const dispatcher = ignoreHttpsErrors
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

  const base = previewUrl.replace(/\/$/, '');

  for (const tc of logoToolCalls) {
    const output = tc.output as GenerateLogoOutput;
    const rawSlots = output?.structuredContent?.slots;
    if (!Array.isArray(rawSlots) || rawSlots.length === 0) continue;

    const slots = rawSlots.map(toSlotPath).filter((s): s is string => s !== null);
    if (slots.length === 0) continue;

    const toolDir = join(trialDir, 'snapshots', 'logos', tc.id);
    await mkdir(toolDir, { recursive: true });

    for (const slotPath of slots) {
      const url = `${base}${slotPath}`;
      const filename = slotFilename(slotPath);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
          ...(dispatcher ? { dispatcher } : {}),
        });
        if (!response.ok) {
          console.warn(
            '[logo-snapshots] HTTP %s fetching %s (tool %s) — skipping',
            response.status, url, tc.id,
          );
          continue;
        }
        await writeFile(
          join(toolDir, filename),
          Buffer.from(await response.arrayBuffer()),
        );
      } catch (err) {
        console.warn(
          '[logo-snapshots] Failed to fetch %s (tool %s): %s',
          url, tc.id, err instanceof Error ? err.message : String(err),
        );
      }
    }
  }
}
