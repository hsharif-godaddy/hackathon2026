import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/api-auth";
import { getLangfuseConfig } from "@/lib/langfuse-client";
import { buildAppIdQuery, getAllLogSources } from "@/lib/log-sources";
import type { LogSourceConfig } from "@/lib/log-sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Track in-flight bundles per appId to prevent concurrent downloads
// overwhelming upstream services (Langfuse, ES).
const inFlightBundles = new Set<string>();

// ---------------------------------------------------------------------------
// Langfuse helpers
// ---------------------------------------------------------------------------

async function findAnchorTimestamp(
  lf: { baseUrl: string; authHeader: string },
  appId: string,
): Promise<{ timestamp: string | null; warning?: string }> {
  const url = `${lf.baseUrl}/api/public/traces?${new URLSearchParams({
    page: "1",
    limit: "1",
    userId: appId,
  })}`;
  const res = await fetch(url, {
    headers: {
      Authorization: lf.authHeader,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      timestamp: null,
      warning: `Langfuse anchor lookup failed: HTTP ${res.status} - ${body.slice(0, 200)}`,
    };
  }
  const data = await res.json();
  const traces = data.data || [];
  if (traces.length === 0) {
    return {
      timestamp: null,
      warning: "No Langfuse traces found for this app",
    };
  }
  return { timestamp: traces[0].timestamp as string };
}

/**
 * Pipe each trace's full HTTP response body directly into an individual
 * archive entry. Only a few KB of TCP buffer is in memory at any time.
 */
async function streamTraces(
  lf: { baseUrl: string; authHeader: string },
  appId: string,
  from: string,
  to: string,
  archive: archiver.Archiver,
): Promise<{ traceCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  let traceCount = 0;
  const PAGE_LIMIT = 20;
  const MAX_PAGES = 5;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
      userId: appId,
      fromTimestamp: from,
      toTimestamp: to,
    });
    const listRes = await fetch(`${lf.baseUrl}/api/public/traces?${params}`, {
      headers: {
        Authorization: lf.authHeader,
        "Content-Type": "application/json",
      },
    });
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => "");
      warnings.push(`Langfuse traces page ${page}: HTTP ${listRes.status} - ${body.slice(0, 200)}`);
      break;
    }
    const listData = await listRes.json();
    const traceIds: string[] = (listData.data || []).map(
      (t: { id: string }) => t.id,
    );
    if (traceIds.length === 0) break;

    // Pipe each trace detail response directly into the archive.
    // Sequential: only one trace response body in flight at a time.
    for (const traceId of traceIds) {
      try {
        const detailRes = await fetch(
          `${lf.baseUrl}/api/public/traces/${traceId}`,
          {
            headers: {
              Authorization: lf.authHeader,
              "Content-Type": "application/json",
            },
          },
        );
        if (!detailRes.ok || !detailRes.body) {
          warnings.push(`Trace ${traceId}: HTTP ${detailRes.status}`);
          continue;
        }

        // Pipe the raw response body stream through the archive entry
        const nodeStream = Readable.fromWeb(
          detailRes.body as import("node:stream/web").ReadableStream,
        );
        archive.append(nodeStream, {
          name: `traces/${traceId}.json`,
        });
        traceCount++;
      } catch (err) {
        warnings.push(
          `Trace ${traceId}: ${err instanceof Error ? err.message : "fetch error"}`,
        );
      }
    }

    const totalPages = listData.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  return { traceCount, warnings };
}

// ---------------------------------------------------------------------------
// ES log helper - pipes raw ES response body directly into archive
// ---------------------------------------------------------------------------

async function streamLogs(
  source: LogSourceConfig,
  appId: string,
  startTime: string,
  endTime: string,
  archive: archiver.Archiver,
): Promise<{ error?: string }> {
  if (
    source.backendType !== "elasticsearch" ||
    !source.endpoint ||
    !source.apiKey ||
    !source.index
  ) {
    archive.append('{"hits":{"hits":[]}}', { name: `logs/${source.id}.json` });
    return { error: "Source not configured or not elasticsearch" };
  }

  const mustClauses: Array<Record<string, unknown>> = [];

  if (appId && source.fieldMapping.appIdField) {
    const appIdQuery = buildAppIdQuery(appId, source.fieldMapping);
    if (appIdQuery) mustClauses.push(appIdQuery);
  }

  mustClauses.push({
    range: { "@timestamp": { gte: startTime, lte: endTime } },
  });

  const body = {
    query:
      mustClauses.length === 1
        ? mustClauses[0]
        : { bool: { must: mustClauses } },
    sort: [{ "@timestamp": { order: "desc" } }],
    size: 1000,
  };

  try {
    // Use filter_path to strip ES metadata and only return hits
    const res = await fetch(
      `${source.endpoint}/${source.index}/_search?ignore_unavailable=true&expand_wildcards=open&filter_path=hits.hits._id,hits.hits._source`,
      {
        method: "POST",
        headers: {
          Authorization: `ApiKey ${source.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      archive.append('{"hits":{"hits":[]}}', { name: `logs/${source.id}.json` });
      return { error: `ES HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    // Pipe the raw ES response body directly through the archive entry.
    // With filter_path, the response is just { hits: { hits: [...] } }.
    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    archive.append(nodeStream, { name: `logs/${source.id}.json` });
    return {};
  } catch (err) {
    archive.append('{"hits":{"hits":[]}}', { name: `logs/${source.id}.json` });
    return {
      error: err instanceof Error ? err.message : "Unknown fetch error",
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const appId = searchParams.get("appId");
  const rawWindow = parseInt(searchParams.get("windowMinutes") || "60", 10);
  const windowMinutes =
    Number.isNaN(rawWindow) || rawWindow < 1 || rawWindow > 1440
      ? 60
      : rawWindow;

  if (!appId) {
    return NextResponse.json({ error: "appId is required" }, { status: 400 });
  }

  if (inFlightBundles.has(appId)) {
    return NextResponse.json(
      { error: "A support bundle is already being generated for this app" },
      { status: 429 },
    );
  }
  inFlightBundles.add(appId);

  let webStream: ReadableStream;
  let filename: string;
  let anchorWarnings: string[];
  let windowStartIso: string;
  let windowEndIso: string;
  let now: string;
  let lf: ReturnType<typeof getLangfuseConfig>;
  let logSources: ReturnType<typeof getAllLogSources>;

  try {
    // 1. Determine time window anchor
    lf = getLangfuseConfig();
    let anchorIso: string;
    anchorWarnings = [];

    if (lf) {
      const anchor = await findAnchorTimestamp(lf, appId);
      anchorIso = anchor.timestamp || new Date().toISOString();
      if (anchor.warning) anchorWarnings.push(anchor.warning);
      if (!anchor.timestamp) {
        anchorWarnings.push("Falling back to current time as anchor");
      }
    } else {
      anchorIso = new Date().toISOString();
      anchorWarnings.push(
        "Langfuse not configured; using current time as anchor",
      );
    }

    const anchorDate = new Date(anchorIso);
    const windowStart = new Date(anchorDate.getTime() - windowMinutes * 60_000);
    // Pad end by 1s so the anchor trace itself is included if Langfuse uses exclusive upper bound
    const windowEnd = new Date(anchorDate.getTime() + 1_000);
    windowStartIso = windowStart.toISOString();
    windowEndIso = windowEnd.toISOString();

    // 2. Set up streaming tar.gz archive
    const passThrough = new PassThrough();
    const archive = archiver("tar", {
      gzip: true,
      gzipOptions: { level: 6 },
    });

    archive.on("error", (err) => {
      console.error("[support-bundle] Archive error:", err.message);
      passThrough.destroy(err);
    });

    archive.pipe(passThrough);

    now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-").slice(0, 19);
    const safeAppId = appId.replace(/[^a-zA-Z0-9_-]/g, "_");
    filename = `support-bundle-${safeAppId}-${ts}.tar.gz`;

    // 3. Return streaming response immediately
    webStream = Readable.toWeb(passThrough) as ReadableStream;

    // TODO: getAllLogSources() returns hardcoded ES configs and does not check LOKI_ENABLED_SOURCES.
    // If a source is migrated to Loki, streamLogs will skip it. Update when Loki sources are used.
    logSources = getAllLogSources();

    // 4. Build archive in background - data streams out as entries are piped.
    // buildArchive's finally block handles inFlightBundles cleanup.
    const buildArchive = async () => {
      const sourceMeta: Record<string, unknown> = {};

      try {
        // Stream traces (one HTTP response body at a time piped through)
        if (lf) {
          const result = await streamTraces(
            lf,
            appId,
            windowStartIso,
            windowEndIso,
            archive,
          );
          const allWarnings = [...anchorWarnings, ...result.warnings];
          sourceMeta.observations = {
            traceCount: result.traceCount,
            ...(allWarnings.length > 0 && { warnings: allWarnings }),
          };
        } else {
          sourceMeta.observations = {
            traceCount: 0,
            warnings: anchorWarnings,
          };
        }

        // Stream logs one source at a time (one HTTP response body at a time)
        for (const src of logSources) {
          const result = await streamLogs(
            src,
            appId,
            windowStartIso,
            windowEndIso,
            archive,
          );
          sourceMeta[src.id] = {
            name: src.name,
            ...(result.error && { error: result.error }),
          };
        }

        // Metadata last (small, buffered is fine)
        const metadata = {
          appId,
          generatedAt: now,
          windowMinutes,
          anchorTimestamp: anchorIso,
          windowStart: windowStartIso,
          windowEnd: windowEndIso,
          structure: {
            "traces/":
              "One JSON file per Langfuse trace (includes observations)",
            "logs/":
              "One JSON file per log source (raw ES response with filter_path=hits.hits._id,hits.hits._source)",
          },
          sources: sourceMeta,
        };
        archive.append(JSON.stringify(metadata, null, 2), {
          name: "metadata.json",
        });

        await archive.finalize();
      } catch (err) {
        console.error(
          "[support-bundle] Build error:",
          err instanceof Error ? err.message : err,
        );
        archive.abort();
      } finally {
        inFlightBundles.delete(appId);
      }
    };

    buildArchive();
  } catch (err) {
    // Setup failed before buildArchive could run; clean up the guard.
    inFlightBundles.delete(appId);
    throw err;
  }

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
