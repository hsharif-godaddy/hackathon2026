import archiver from "archiver";
import { Readable } from "node:stream";

import { logger } from "@/lib/logger";

export async function findAnchorTimestamp(
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
  // Guard against non-JSON 200s (proxy returning an HTML error page). Without
  // this, res.json() throws a bare SyntaxError up to buildArchive's catch and
  // aborts the entire bundle. Mirrors the guard in iterLokiEventLines.
  let data: { data?: Array<{ timestamp: string }> };
  try {
    data = await res.json();
  } catch (err) {
    return {
      timestamp: null,
      warning: `Langfuse anchor returned a non-JSON 200 response: ${err instanceof Error ? err.message : "parse error"}`,
    };
  }
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
export async function streamTraces(
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
    // See findAnchorTimestamp: same non-JSON 200 guard so a proxy HTML page
    // surfaces as a recorded warning instead of aborting the bundle.
    let listData: { data?: Array<{ id: string }>; meta?: { totalPages?: number } };
    try {
      listData = await listRes.json();
    } catch (err) {
      warnings.push(
        `Langfuse traces page ${page}: non-JSON 200 response (${err instanceof Error ? err.message : "parse error"})`
      );
      break;
    }
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
        logger.warn(
          "supportBundle.langfuse.traceFetchFailed",
          { traceId, appId },
          { error: err instanceof Error ? err : new Error(String(err)) },
        );
      }
    }

    const totalPages = listData.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  return { traceCount, warnings };
}
