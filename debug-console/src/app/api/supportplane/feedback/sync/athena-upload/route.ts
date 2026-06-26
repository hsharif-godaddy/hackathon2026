import { type NextRequest } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getSpEnv } from '@/lib/supportplane/store/config';
import {
  insertFeedbackAthenaRow,
  rebuildFeedbackComposite,
  recomputeDailyStats,
} from '@/lib/supportplane/db/feedback-db';

// ── CSV parser ────────────────────────────────────────────────────────────────
// Record-aware parser for the Athena console "Download results" CSV export.
// Quotes are honored across the entire document, so a quoted field containing
// commas OR embedded newlines stays intact. A naive line-split (split on '\n'
// then parse) would shred a multi-line feedback_text into bogus records, so we
// tokenize the whole text in one pass and only break a record on a newline that
// is OUTSIDE quotes. `""` inside a quoted field is an escaped double-quote.

function tokenizeCsv(text: string): string[][] {
  const normalized: string = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch: string = normalized[i];
    if (inQuote) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuote = false;
      } else {
        field += ch; // commas and newlines are literal inside quotes
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n') {
      fields.push(field);
      records.push(fields);
      fields = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Flush the final field/record when the file doesn't end with a newline.
  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }
  return records;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Drop blank records (empty lines between rows = a single empty field).
  const records: string[][] = tokenizeCsv(text).filter(
    (rec) => !(rec.length === 1 && rec[0].trim() === '')
  );
  if (records.length === 0) return { headers: [], rows: [] };

  const headers: string[] = records[0].map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < records.length; i++) {
    const values: string[] = records[i];
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const hdr: string = headers[j];
      if (hdr) row[hdr] = values[j] ?? '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function str(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s === '' || s === 'null' ? null : s;
}

function num(v: string | undefined): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function flag(v: string | undefined): number | null {
  const s = str(v);
  if (!s) return null;
  if (s === 'true' || s === '1') return 1;
  if (s === 'false' || s === '0') return 0;
  return null;
}

function feedbackIdFromRow(row: Record<string, string>, env: string): string {
  const fid = str(row['feedback_id']);
  if (fid) return fid;
  const ts = str(row['feedback_utc_ts']) ?? '';
  const cid = str(row['customer_id']) ?? '';
  return `athena-csv:${env}:${ts}:${cid}`;
}

function rowToParams(row: Record<string, string>, env: string): unknown[] {
  const feedbackId = feedbackIdFromRow(row, env);
  return [
    feedbackId,
    env,
    str(row['app_id']),
    str(row['customer_id']),
    str(row['feedback_utc_ts']),
    num(row['rating']),
    str(row['feedback_text']),
    flag(row['consent_flag']),
    str(row['plan_type_name']),
    str(row['subscription_id']),
    str(row['subscription_status']),
    num(row['total_credit_cnt']),
    num(row['available_credit_cnt']),
    str(row['feedback_topic_list']),
    str(row['feedback_origin_name']),
    flag(row['app_publish_flag']),
    str(row['publish_url']),
    str(row['cln_create_utc_ts']),
  ];
}

// ── Route ─────────────────────────────────────────────────────────────────────

const EXPECTED_HEADERS = [
  'app_id', 'customer_id', 'feedback_utc_ts', 'rating', 'feedback_text',
];

export const POST = withAuth(async (req: NextRequest) => {
  const contentType: string = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), { status: 400 });
  }

  let csvText: string;
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ error: 'Missing file field in form data' }), { status: 400 });
    }
    csvText = await (file as File).text();
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to read upload: ${(err as Error).message}` }), { status: 400 });
  }

  const env = getSpEnv();
  const { headers, rows } = parseCsv(csvText);

  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: 'CSV is empty or has no data rows' }), { status: 400 });
  }

  const missingHeaders = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
  const warnings: string[] = missingHeaders.length > 0
    ? [`Missing expected columns: ${missingHeaders.join(', ')}`]
    : [];

  logger.info('supportplane.feedback.athena-upload.start', { env, rows: rows.length, headers: headers.join(',') });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ phase: 'start', total: rows.length });

      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      const affectedDates = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const params = rowToParams(row, env);
          const written = await insertFeedbackAthenaRow(params, true);
          const ts = str(row['feedback_utc_ts']);
          if (ts) affectedDates.add(ts.slice(0, 10));
          // insertFeedbackAthenaRow writes the raw row and returns 1; it returns 0
          // only when the row has no feedback_id (cannot be keyed) — i.e. skipped.
          // There is no "merge" at this stage — dedup/enrichment happens later in
          // rebuildFeedbackComposite().
          if (written > 0) inserted++;
          else skipped++;
        } catch (err) {
          errors++;
          if (errors <= 5) {
            warnings.push(`Row error: ${(err as Error).message.slice(0, 100)}`);
          }
        }

        if ((i + 1) % 200 === 0 || i === rows.length - 1) {
          send({ phase: 'processing', processed: i + 1, total: rows.length, newRows: inserted, skipped, errors });
        }
      }

      send({ phase: 'aggregating', processed: rows.length, total: rows.length, newRows: inserted, skipped, errors });

      // If every single row failed, treat this as a hard error (most likely the
      // raw tables aren't populated yet — run the legacy migration first).
      if (errors > 0 && errors === rows.length) {
        const cause = warnings[0] ?? 'Unknown error';
        const hint = cause.includes('non-existent table')
          ? ' Use the "Migrate from Legacy" button in the Browse tab to populate the raw tables first.'
          : '';
        send({
          phase: 'error',
          processed: rows.length,
          total: rows.length,
          newRows: 0,
          skipped: 0,
          errors,
          message: `All ${rows.length} rows failed — ${cause}${hint}`,
          warnings,
        });
        controller.close();
        return;
      }

      try {
        await rebuildFeedbackComposite(env);
        if (affectedDates.size > 0) {
          await recomputeDailyStats(env, [...affectedDates]);
        }
      } catch (err) {
        warnings.push(`Stats rebuild error: ${(err as Error).message.slice(0, 80)}`);
      }

      const message = `Uploaded ${rows.length} rows: ${inserted} new, ${skipped} skipped (no feedback_id), ${errors} errors`;
      logger.info('supportplane.feedback.athena-upload.complete', {
        env, total: rows.length, inserted, skipped, errors,
      });

      // Partial errors: send done but flag so UI shows warning state
      send({ phase: errors > 0 ? 'done_with_errors' : 'done', processed: rows.length, total: rows.length, newRows: inserted, skipped, errors, message, warnings });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
