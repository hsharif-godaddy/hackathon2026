// SERVER-ONLY: imports fullstory-mcp-client which reads FULLSTORY_API_KEY.
// Do not import from client components.

import {
  buildAiroSegmentQuery,
  callFullstoryMcpTool,
  FullstoryMcpError,
  getFullstoryMcpConfig,
  parseFullstorySessionUrl,
} from '@/lib/fullstory-mcp-client';
import { buildFsDeepLink } from '@/lib/analytics/scorecard/fs-utils';
import type { AppJourneyData, JourneyEvent, JourneySession } from '@/app/scorecard/types';

const JOURNEY_MAX_SESSIONS = 5;
const JOURNEY_LIST_LIMIT = 10;
const JOURNEY_MAX_EVENTS_PER_SESSION = 500;
const PUBLISH_PATH_PATTERN = /\bpublish\b/i;
const PAIN_EVENT_PATTERN = /rage[-_ ]?click|dead[-_ ]?click|error[-_ ]?click|console-error|exception|uncaught|\berror\b/i;

interface FsSessionRef {
  device_id: string;
  session_id: string;
  session_url?: string;
}

interface FsBuildSegmentResponse {
  segment_id?: string;
}

interface FsGetSessionsResponse {
  sessions?: FsSessionRef[];
}

interface FsGetSessionEventsResponse {
  events?: string;
  session_url?: string;
}

function parseOffsetSec(line: string, prev: number): number {
  const abs = line.match(/^\s*\[(\d+):(\d{1,2})\]/);
  if (abs) return Number(abs[1]) * 60 + Number(abs[2]);
  const rel = line.match(/\(\+(\d+)s\)/);
  if (rel) return prev + Number(rel[1]);
  return prev;
}

function detectEventName(line: string): string {
  const match = line.match(/\b(navigate|click|element-seen|rage-click|dead-click|error-click|console-error|feedback|page-view|scroll)\b/i);
  return match ? match[1].toLowerCase() : 'event';
}

function eventsFromText(
  session: FsSessionRef,
  eventsText: string,
  anchorEpochMs: number | undefined,
): JourneyEvent[] {
  const lines: string[] = eventsText
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('<<<') && !l.startsWith('>>>'));

  // Compute max session offset to derive start when anchor epoch is known
  let maxOffsetSec = 0;
  {
    let cursor = 0;
    for (const line of lines) {
      cursor = parseOffsetSec(line, cursor);
      if (cursor > maxOffsetSec) maxOffsetSec = cursor;
    }
  }
  // With anchor: real UTC timestamps. Without: 1970-relative session offsets
  // (offset_seconds in event.data is the correlation handle in that case).
  const sessionStartMs: number = anchorEpochMs != null ? anchorEpochMs - maxOffsetSec * 1000 : 0;
  const hasRealTime: boolean = anchorEpochMs != null;

  const events: JourneyEvent[] = [];
  let offsetSec = 0;
  for (const line of lines) {
    offsetSec = parseOffsetSec(line, offsetSec);
    const isError: boolean = PAIN_EVENT_PATTERN.test(line);
    if (!isError && events.length >= JOURNEY_MAX_EVENTS_PER_SESSION) continue;
    const tsMs: number = sessionStartMs + offsetSec * 1000;
    const timestamp: string = new Date(tsMs).toISOString();
    const eventName: string = detectEventName(line);
    const isKeyEvent: boolean = isError || eventName === 'navigate' || eventName === 'feedback';
    const sessionUrl: string | undefined = session.session_url;
    const fullstoryUrl: string | null = (hasRealTime && sessionUrl)
      ? buildFsDeepLink(sessionUrl, timestamp)
      : (sessionUrl ?? null);
    events.push({
      timestamp,
      event: eventName,
      label: line.trim().slice(0, 300),
      data: {
        device_id: session.device_id,
        session_id: session.session_id,
        offset_seconds: offsetSec,
      },
      fullstoryUrl,
      isKeyEvent,
      status: isError ? 'error' : 'info',
    });
  }
  return events;
}

function inferOutcome(events: JourneyEvent[]): JourneySession['outcome'] {
  for (const ev of events) {
    if (PUBLISH_PATH_PATTERN.test(ev.label)) return 'published';
  }
  return 'in_progress';
}

export async function getJourneyData(appId: string, lookbackDays = 7): Promise<AppJourneyData> {
  const config = getFullstoryMcpConfig();
  if (!config) throw new Error('FULLSTORY_API_KEY not configured');

  const segmentQuery: string = buildAiroSegmentQuery(appId, lookbackDays);
  const segmentName: string = `airo-scorecard-${appId}`;
  const segment = await callFullstoryMcpTool<FsBuildSegmentResponse>(
    config,
    'build_segment',
    { query: segmentQuery, name: segmentName },
  );
  if (!segment.segment_id) {
    throw new FullstoryMcpError('build_segment returned no segment_id');
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const sessionList = await callFullstoryMcpTool<FsGetSessionsResponse>(
    config,
    'get_sessions',
    {
      segment_id: segment.segment_id,
      limit: JOURNEY_LIST_LIMIT,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    },
  );
  const found: FsSessionRef[] = Array.isArray(sessionList.sessions) ? sessionList.sessions : [];
  if (found.length === 0) {
    return { appId, env: 'prod', totalSessions: 0, firstSeen: '', lastSeen: '', sessions: [], businessName: null };
  }

  const picked: FsSessionRef[] = found.slice(0, JOURNEY_MAX_SESSIONS);
  const sessionResults: Array<JourneySession | null> = await Promise.all(
    picked.map(async (session): Promise<JourneySession | null> => {
      try {
        const eventsResult = await callFullstoryMcpTool<FsGetSessionEventsResponse>(
          config,
          'get_session_events',
          { device_id: session.device_id, session_id: session.session_id },
        );
        const eventsText: string = eventsResult.events ?? '';
        const sessionUrl: string | null = session.session_url ?? eventsResult.session_url ?? null;
        const ref: FsSessionRef = { ...session, ...(sessionUrl ? { session_url: sessionUrl } : {}) };
        const parsed = sessionUrl ? parseFullstorySessionUrl(sessionUrl) : null;
        const anchorEpochMs: number | undefined = parsed?.anchorEpochMs;
        const events: JourneyEvent[] = eventsFromText(ref, eventsText, anchorEpochMs);
        const firstTs: string = events[0]?.timestamp ?? '';
        const lastTs: string = events[events.length - 1]?.timestamp ?? firstTs;
        const startMs: number = firstTs ? new Date(firstTs).getTime() : 0;
        const endMs: number = lastTs ? new Date(lastTs).getTime() : 0;
        return {
          sessionId: session.session_id,
          startTime: firstTs,
          endTime: lastTs,
          durationMs: Math.max(0, endMs - startMs),
          fullstorySessionUrl: sessionUrl,
          events,
          outcome: inferOutcome(events),
        };
      } catch {
        return null;
      }
    }),
  );

  const sessions: JourneySession[] = sessionResults.filter((s): s is JourneySession => s !== null);
  const allTimes: string[] = sessions.flatMap((s) => [s.startTime, s.endTime]).filter(Boolean);
  const firstSeen: string = allTimes.length > 0 ? allTimes.reduce((a, b) => (a < b ? a : b)) : '';
  const lastSeen: string = allTimes.length > 0 ? allTimes.reduce((a, b) => (a > b ? a : b)) : '';
  return {
    appId,
    env: 'prod',
    totalSessions: found.length,
    firstSeen,
    lastSeen,
    sessions,
    businessName: null,
  };
}
