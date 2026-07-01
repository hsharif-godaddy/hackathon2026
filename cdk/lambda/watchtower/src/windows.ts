const HOUR_MS = 60 * 60 * 1000;

// Returns the most recent *settled* full hour — the hour that ended one hour
// ago, NOT the hour that just closed. ESSP log ingestion lags real time by
// minutes, so the just-closed hour is often still filling when we run; rolling
// it up then would under-count (or zero) it permanently. A one-hour watermark
// is far larger than normal lag, so each stored hour is complete.
// (Phase 3, when the tripwire needs freshness, switches to the langfuse-style
// re-upsert: run every few minutes with a deterministic per-hour doc id and
// overwrite the current hour until it settles.)
export function hourWindow(nowMs: number): { startIso: string; endIso: string } {
  const currentHourStart = new Date(nowMs);
  currentHourStart.setUTCMinutes(0, 0, 0);
  const end = new Date(currentHourStart.getTime() - HOUR_MS);
  const start = new Date(end.getTime() - HOUR_MS);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
