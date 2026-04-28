import archiver from "archiver";
import { Readable } from "node:stream";

import { logger } from "@/lib/logger";
import {
  buildAppIdQuery,
  DEFAULT_SUMMARY_SOURCE_IDS,
  getLogSourceConfig,
} from "@/lib/log-sources";
import type { LogSourceConfig } from "@/lib/log-sources";
import { buildLokiQuery, queryLoki, transformLokiResponse } from "@/lib/loki-client";

async function streamLogs(
  source: LogSourceConfig,
  appId: string,
  startTime: string,
  endTime: string,
  archive: archiver.Archiver,
): Promise<{ error?: string }> {
  if (source.backendType === "loki") {
    return streamLokiLogs(source, appId, startTime, endTime, archive);
  }

  if (
    source.backendType !== "elasticsearch" ||
    !source.endpoint ||
    !source.apiKey ||
    !source.index
  ) {
    appendEmptyLogEntry(archive, source.id);
    return { error: "Elasticsearch source missing endpoint, apiKey, or index" };
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
      appendEmptyLogEntry(archive, source.id);
      return { error: `ES HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    archive.append(nodeStream, { name: `logs/${source.id}.json` });
    return {};
  } catch (err) {
    appendEmptyLogEntry(archive, source.id);
    return {
      error: err instanceof Error ? err.message : "Unknown fetch error",
    };
  }
}

const SUPPORT_BUNDLE_LOKI_LIMIT = 5000;

function appendJsonEntry(
  archive: archiver.Archiver,
  name: string,
  body: unknown,
): boolean {
  try {
    archive.append(JSON.stringify(body), { name });
    return true;
  } catch (err) {
    logger.error("supportBundle.archive.appendFailed", { name }, {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return false;
  }
}

function appendEmptyLogEntry(
  archive: archiver.Archiver,
  sourceId: string,
  error?: string,
): boolean {
  return appendJsonEntry(
    archive,
    `logs/${sourceId}.json`,
    error ? { hits: { hits: [] }, error } : { hits: { hits: [] } },
  );
}

export async function streamLokiLogs(
  source: LogSourceConfig,
  appId: string,
  startTime: string,
  endTime: string,
  archive: archiver.Archiver,
): Promise<{ error?: string }> {
  try {
    const lokiConfig = {
      lokiEndpoint: source.lokiEndpoint,
      lokiApiKey: source.lokiApiKey,
      lokiLabels: source.lokiLabels,
    };
    const lokiParams = await buildLokiQuery(
      { appId, startTime, endTime, size: SUPPORT_BUNDLE_LOKI_LIMIT },
      lokiConfig,
    );

    const response = await queryLoki(lokiConfig, lokiParams);
    const logs = transformLokiResponse(response, source.fieldMapping, source.id);
    const envelope: { hits: { hits: unknown[] }; truncated?: true } = {
      hits: {
        hits: logs.map((log, index) => ({
          _id: log.id || `${source.id}-${index}`,
          _source: log.raw ?? {
            '@timestamp': log.timestamp,
            level: log.level,
            message: log.message,
            event: log.event,
          },
        })),
      },
    };

    if (logs.length >= lokiParams.limit) {
      envelope.truncated = true;
    }

    archive.append(JSON.stringify(envelope), { name: `logs/${source.id}.json` });
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Loki fetch error";
    logger.error(
      "supportBundle.loki.streamFailed",
      { sourceId: source.id },
      { error: err instanceof Error ? err : new Error(message) },
    );
    appendEmptyLogEntry(archive, source.id, message);
    return { error: message };
  }
}

export async function streamConfiguredLogSources(
  archive: archiver.Archiver,
  appId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<Record<string, unknown>> {
  const sourceMeta: Record<string, unknown> = {};

  for (const sourceId of DEFAULT_SUMMARY_SOURCE_IDS) {
    let src: LogSourceConfig | null;
    try {
      src = getLogSourceConfig(sourceId);
    } catch (err) {
      logger.error(
        "supportBundle.logSource.configFailed",
        { sourceId },
        { error: err instanceof Error ? err : new Error(String(err)) },
      );
      appendEmptyLogEntry(archive, sourceId);
      sourceMeta[sourceId] = {
        error:
          err instanceof Error
            ? err.message
            : "Failed to build log source config",
      };
      continue;
    }

    if (!src) {
      appendEmptyLogEntry(archive, sourceId);
      sourceMeta[sourceId] = { error: "Unknown log source" };
      continue;
    }

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

  return sourceMeta;
}
