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
import type {
  AppJourneyData,
  JourneyEvent,
  JourneyEventCategory,
  JourneyListData,
  JourneySession,
  JourneySessionMeta,
} from '@/app/scorecard/types';

// FullStory get_sessions API hard-caps at 50 results per page.
const JOURNEY_LIST_LIMIT = 50;

// Pain / error signal patterns stay as the hard error cap bypass.
const PUBLISH_PATH_PATTERN = /\bpublish\b/i;
const PAIN_EVENT_PATTERN   = /rage[-_ ]?click|dead[-_ ]?click|error[-_ ]?click|console-error|exception|uncaught|\berror\b/i;
// FullStory custom SDK events always include [event=map[ in their payload.
// Native auto-captured events use [element^ format instead.
const CUSTOM_SDK_EVENT_PATTERN = /\[event=map\[/;

interface FsSessionRef {
  device_id?:    string;
  session_id?:   string;
  session_url?:  string;
  created_time?: string; // returned by some FS API versions
}

interface FsBuildSegmentResponse {
  segment_id?: string;
}

interface FsGetSessionsResponse {
  sessions?:   FsSessionRef[];
  page_token?: string; // cursor for the next page; absent when no more results
}

interface FsGetSessionEventsResponse {
  events?:      string;
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
  // Strip leading timestamp before matching so we don't pick up event-name
  // keywords that appear inside custom event payloads later in the line.
  const stripped = line
    .replace(/^\s*\[\d+:\d{1,2}\]\s*/, '')  // [MM:SS] absolute offset
    .replace(/^\s*\(\+\d+s\)\s*/, '')        // (+Xs) relative offset
    .trim();
  const match = stripped.match(/^(navigate|click|input-change|element-seen|rage-click|dead-click|error-click|console-error|feedback|page-view|scroll)\b/i);
  return match ? match[1].toLowerCase() : 'event';
}

function categorizeEvent(line: string, eventName: string): JourneyEventCategory {
  if (PAIN_EVENT_PATTERN.test(line)) return 'error';
  // Custom Airo SDK events fired via FS.event() always have [event=map[ in their payload.
  // Classify them as instrumentation regardless of what the event name prefix looks like.
  if (CUSTOM_SDK_EVENT_PATTERN.test(line)) return 'instrumentation';
  if (eventName === 'feedback') return 'feedback';
  if (eventName === 'navigate' || eventName === 'page-view') return 'navigation';
  if (eventName === 'click' || eventName === 'input-change' || eventName === 'element-seen' || eventName === 'scroll') return 'interaction';
  return 'instrumentation';
}

function eventsFromText(
  session:        FsSessionRef,
  eventsText:     string,
  anchorEpochMs:  number | undefined,
): JourneyEvent[] {
  const lines: string[] = eventsText
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('<<<') && !l.startsWith('>>>'));

  let maxOffsetSec = 0;
  {
    let cursor = 0;
    for (const line of lines) {
      cursor = parseOffsetSec(line, cursor);
      if (cursor > maxOffsetSec) maxOffsetSec = cursor;
    }
  }
  const sessionStartMs: number = anchorEpochMs != null ? anchorEpochMs - maxOffsetSec * 1000 : 0;
  const hasRealTime: boolean   = anchorEpochMs != null;

  const events: JourneyEvent[] = [];
  let offsetSec = 0;
  for (const line of lines) {
    offsetSec = parseOffsetSec(line, offsetSec);
    const tsMs: number       = sessionStartMs + offsetSec * 1000;
    const timestamp: string  = new Date(tsMs).toISOString();
    const eventName: string  = detectEventName(line);
    const category           = categorizeEvent(line, eventName);
    const isError: boolean   = category === 'error';
    const isKeyEvent: boolean = isError || eventName === 'navigate' || eventName === 'feedback' || category === 'instrumentation';
    const sessionUrl: string | undefined = session.session_url;
    const fullstoryUrl: string | null = (hasRealTime && sessionUrl)
      ? buildFsDeepLink(sessionUrl, timestamp)
      : (sessionUrl ?? null);
    events.push({
      timestamp,
      event:     eventName,
      label:     line.trim().slice(0, 300),
      data:      { device_id: session.device_id, session_id: session.session_id, offset_seconds: offsetSec },
      fullstoryUrl,
      isKeyEvent,
      status:    isError ? 'error' : category === 'instrumentation' ? 'success' : 'info',
      category,
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

// ── Build segment and return session metadata only (no events). ──────────────

/**
 * Fetch one page of session metadata.
 *
 * - First call: omit `pageToken` and `existingSegmentId` — the segment is built
 *   automatically and returned in the result as `segmentId`.
 * - Subsequent calls: pass `pageToken` + `segmentId` from the previous result to
 *   skip rebuilding the segment and jump straight to the next page.
 */
export async function getJourneySessions(
  appId:              string,
  lookbackDays:       number,
  pageToken?:         string,
  existingSegmentId?: string,
): Promise<JourneyListData> {
  const config = getFullstoryMcpConfig();
  if (!config) throw new Error('FULLSTORY_API_KEY not configured');

  // Re-use the existing segment when paginating to avoid a redundant MCP round-trip.
  let segmentId: string;
  if (existingSegmentId) {
    segmentId = existingSegmentId;
  } else {
    const segmentQuery: string = buildAiroSegmentQuery(appId, lookbackDays);
    const segmentName: string  = `airo-scorecard-${appId}`;
    const segment = await callFullstoryMcpTool<FsBuildSegmentResponse>(
      config,
      'build_segment',
      { query: segmentQuery, name: segmentName },
    );
    if (!segment.segment_id) throw new FullstoryMcpError('build_segment returned no segment_id');
    segmentId = segment.segment_id;
  }

  const endDate   = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const sessionArgs: Record<string, unknown> = {
    segment_id: segmentId,
    limit:      JOURNEY_LIST_LIMIT,
    start_time: startDate.toISOString(),
    end_time:   endDate.toISOString(),
  };
  if (pageToken) sessionArgs.page_token = pageToken;

  const sessionList = await callFullstoryMcpTool<FsGetSessionsResponse>(
    config,
    'get_sessions',
    sessionArgs,
  );

  const found: FsSessionRef[] = Array.isArray(sessionList.sessions) ? sessionList.sessions : [];
  const sessions: JourneySessionMeta[] = found
    .filter((s): s is FsSessionRef & { session_id: string; device_id: string } =>
      typeof s.session_id === 'string' && typeof s.device_id === 'string'
    )
    .map((s) => ({
      sessionId:           s.session_id,
      deviceId:            s.device_id,
      startTime:           s.created_time ?? '',
      fullstorySessionUrl: s.session_url ?? null,
    }));

  return {
    appId,
    totalSessions: found.length,
    lookbackDays,
    sessions,
    segmentId,
    ...(sessionList.page_token ? { nextPageToken: sessionList.page_token } : {}),
  };
}

// ── Load events for one session (called lazily per session). ─────────────────

export async function getJourneySessionEvents(
  deviceId:   string,
  sessionId:  string,
  sessionUrl: string | undefined,
): Promise<JourneySession | null> {
  const config = getFullstoryMcpConfig();
  if (!config) throw new Error('FULLSTORY_API_KEY not configured');

  const eventsResult = await callFullstoryMcpTool<FsGetSessionEventsResponse>(
    config,
    'get_session_events',
    { device_id: deviceId, session_id: sessionId },
  );

  const eventsText: string   = eventsResult.events ?? '';
  const resolvedUrl: string | null = sessionUrl ?? eventsResult.session_url ?? null;
  const ref: FsSessionRef    = { device_id: deviceId, session_id: sessionId, ...(resolvedUrl ? { session_url: resolvedUrl } : {}) };
  const parsed               = resolvedUrl ? parseFullstorySessionUrl(resolvedUrl) : null;
  const anchorEpochMs        = parsed?.anchorEpochMs;
  const events: JourneyEvent[] = eventsFromText(ref, eventsText, anchorEpochMs);

  if (events.length === 0) return null;

  const firstTs: string  = events[0]?.timestamp ?? '';
  const lastTs: string   = events[events.length - 1]?.timestamp ?? firstTs;
  const startMs: number  = firstTs ? new Date(firstTs).getTime() : 0;
  const endMs: number    = lastTs  ? new Date(lastTs).getTime()  : 0;

  return {
    sessionId,
    deviceId,
    startTime:           firstTs,
    endTime:             lastTs,
    durationMs:          Math.max(0, endMs - startMs),
    fullstorySessionUrl: resolvedUrl,
    events,
    outcome:             inferOutcome(events),
  };
}

// ── Legacy full-fetch (still used by the old journey action). ─────────────────

export async function getJourneyData(appId: string, lookbackDays = 365): Promise<AppJourneyData> {
  const list = await getJourneySessions(appId, lookbackDays);
  if (list.sessions.length === 0) {
    return { appId, env: 'prod', totalSessions: 0, firstSeen: '', lastSeen: '', sessions: [], businessName: null };
  }

  const sessionResults: Array<JourneySession | null> = await Promise.all(
    list.sessions.slice(0, 10).map(async (meta): Promise<JourneySession | null> => {
      try {
        return await getJourneySessionEvents(meta.deviceId, meta.sessionId, meta.fullstorySessionUrl ?? undefined);
      } catch {
        return null;
      }
    }),
  );

  const sessions: JourneySession[] = sessionResults.filter((s): s is JourneySession => s !== null);
  const allTimes: string[] = sessions.flatMap((s) => [s.startTime, s.endTime]).filter(Boolean);
  return {
    appId,
    env:           'prod',
    totalSessions: list.totalSessions,
    firstSeen:     allTimes.length > 0 ? allTimes.reduce((a, b) => (a < b ? a : b)) : '',
    lastSeen:      allTimes.length > 0 ? allTimes.reduce((a, b) => (a > b ? a : b)) : '',
    sessions,
    businessName:  null,
  };
}
