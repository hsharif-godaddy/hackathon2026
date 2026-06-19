import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";

import { findAnchorTimestamp, streamTraces } from "@/app/api/support-bundle/langfuse-streams";
import { streamConfiguredLogSources } from "@/app/api/support-bundle/log-streams";
import { withAuth } from "@/lib/api-auth";
import { getLangfuseEbConfig, resolveCustomerId } from "@/lib/langfuse-eb-client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Track in-flight bundles per appId to prevent concurrent downloads
// overwhelming upstream services (Langfuse, ES).
const inFlightBundles = new Set<string>();

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
  let lf: ReturnType<typeof getLangfuseEbConfig>;
  // EB scopes traces by an unindexed metadata filter; pairing it with the
  // indexed userId=customerId avoids the "too broad" 422. Resolved once and
  // reused by both the anchor lookup and the trace stream.
  let customerId: string | null = null;

  try {
    // 1. Determine time window anchor
    lf = getLangfuseEbConfig();
    let anchorIso: string;
    anchorWarnings = [];

    if (lf) {
      customerId = await resolveCustomerId(appId);
      if (!customerId) {
        anchorWarnings.push(
          "Could not resolve customerId; Langfuse queries fall back to a broad (slower) filter",
        );
      }
      const anchor = await findAnchorTimestamp(lf, appId, customerId);
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
      logger.error("supportBundle.archive.error", { appId }, { error: err });
      passThrough.destroy(err);
    });

    archive.pipe(passThrough);

    now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-").slice(0, 19);
    const safeAppId = appId.replace(/[^a-zA-Z0-9_-]/g, "_");
    filename = `support-bundle-${safeAppId}-${ts}.tar.gz`;

    // 3. Return streaming response immediately
    webStream = Readable.toWeb(passThrough) as ReadableStream;

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
            customerId,
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

        // Stream logs one source at a time. Per-source error isolation lives
        // in streamConfiguredLogSources so a misconfigured backend (e.g.
        // missing LOKI_ENDPOINT) degrades to an empty entry rather than
        // aborting the bundle. Traces and other sources still complete.
        const logSourceMeta = await streamConfiguredLogSources(
          archive,
          appId,
          windowStartIso,
          windowEndIso,
        );
        Object.assign(sourceMeta, logSourceMeta);

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
              "One JSON file per log source in { hits: { hits: [{ _id, _source }] } } shape",
          },
          sources: sourceMeta,
        };
        archive.append(JSON.stringify(metadata, null, 2), {
          name: "metadata.json",
        });

        await archive.finalize();
      } catch (err) {
        logger.error(
          "supportBundle.build.error",
          { appId },
          { error: err instanceof Error ? err : new Error(String(err)) },
        );
        archive.abort();
      } finally {
        inFlightBundles.delete(appId);
      }
    };

    buildArchive().catch((err) => {
      inFlightBundles.delete(appId);
      logger.error(
        "supportBundle.build.unhandledRejection",
        { appId },
        { error: err instanceof Error ? err : new Error(String(err)) },
      );
      archive.abort();
    });
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
