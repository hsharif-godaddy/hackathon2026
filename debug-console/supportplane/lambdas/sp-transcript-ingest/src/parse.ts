/**
 * parse.ts — xlsx/csv parsing + row→record mapping for L1 transcripts.
 *
 * Vendored from debug-console `src/lib/l1-transcript-ingestion.ts`. The parsing
 * behavior (multi-row transcript accumulation, interaction_id heuristics, BOM
 * handling, delimiter detection, encrypted-xlsx fallbacks) is intentionally
 * identical to the in-process path this Lambda replaces. Only the module's
 * logger source differs (see log.ts) and the ambient row type is `any` because
 * CSV/xlsx cell data is genuinely dynamic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as XLSX from 'xlsx';
import XlsxPopulate from 'xlsx-populate';
import { v4 as uuidv4 } from 'uuid';

import {
  sanitizeText,
  mapCountryToLanguage,
  mapSentimentToScore,
  mapResolutionToStatus,
  parseColumnValue,
} from './utils.js';
import { logger } from './log.js';

/**
 * Raw CSV row structure - flexible to handle any column set.
 */
export interface RawCsvRow {
  interaction_id?: string;
  shopper_id?: string;
  full_transcript?: string;
  conversation_redacted_text?: string;
  transcript?: string;
  conversation_text?: string;
  conversation_summary?: string;
  customer_id?: string;
  etl_build_mst_ts?: string;
  rpt_mst_date?: string;
  issue_resolution?: string;
  customer_sentiment?: string;
  country?: string;
  agent_skill_raw?: string;
  handled_repeat_contact_platform?: string;
  agent_department?: string;
  call_type?: string;
  transcript_viewer?: string;
  [key: string]: string | undefined;
}

/**
 * Transcript record ready for database insert.
 */
export interface TranscriptRecord {
  interaction_id: string;
  app_id?: string;
  domain?: string;
  shopper_id: string;
  customer_id?: string;
  tags?: string;
  conversation_summary?: string;
  full_transcript: string;
  created_at?: string;
  updated_at?: string;
  ingested_at?: string;
  source_s3_key?: string;
  source_file_hash?: string;
  xlsx_row_index?: number;
  interaction_type?: string;
  interaction_status?: string;
  resolution_time_seconds?: number;
  agent_name?: string;
  category?: string;
  subcategory?: string;
  sentiment_score?: number;
  language?: string;
  raw_data?: string;
}

/**
 * Validate that buffer is a valid ZIP file (XLSX files are ZIP containers).
 */
function isValidZipFile(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * Parse xlsx or csv file and return rows.
 */
export async function parseXlsxFile(buffer: Buffer, filename?: string): Promise<RawCsvRow[]> {
  const isCsv: boolean = filename?.toLowerCase().endsWith('.csv') ?? false;
  const password: string | undefined = process.env.L1_TRANSCRIPTS_XLSX_PASSWORD;

  let workbook: XLSX.WorkBook | undefined;

  try {
    logger.info('supportplane.l1_transcript.ingestion.parse.start', {});

    if (isCsv) {
      const sample: string = buffer.toString('utf8', 0, Math.min(1000, buffer.length));
      const commaCount: number = (sample.match(/,/g) || []).length;
      const semicolonCount: number = (sample.match(/;/g) || []).length;
      const tabCount: number = (sample.match(/\t/g) || []).length;

      let delimiter = ',';
      if (semicolonCount > commaCount && semicolonCount > tabCount) {
        delimiter = ';';
      } else if (tabCount > commaCount && tabCount > semicolonCount) {
        delimiter = '\t';
      }

      logger.info('supportplane.l1_transcript.ingestion.delimiter_detected', {
        delimiter: delimiter === '\t' ? '\\t' : delimiter,
        counts: { comma: commaCount, semicolon: semicolonCount, tab: tabCount },
      });

      if (delimiter !== ',') {
        const csvText: string = buffer.toString('utf8').replace(new RegExp(delimiter, 'g'), ',');
        workbook = XLSX.read(csvText, { type: 'string', raw: true });
      } else {
        workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
      }
    } else {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    }

    logger.info('supportplane.l1_transcript.ingestion.parse.success', {});
  } catch (error: any) {
    logger.warn('supportplane.l1_transcript.ingestion.parse.initial_failed', {
      message: error.message,
    });

    const isZipStructureError: boolean =
      error.message?.includes('end of central directory') ||
      error.message?.includes('not a zip file') ||
      error.message?.includes('invalid zip');

    if (isZipStructureError && !isCsv) {
      if (!isValidZipFile(buffer)) {
        logger.error('supportplane.l1_transcript.ingestion.parse.corrupted_file', {
          bufferSize: buffer.length,
          firstBytes: buffer.slice(0, 8).toString('hex'),
        });
        throw new Error(
          'Invalid or corrupted XLSX file. The file does not have a valid ZIP structure. ' +
            'Please verify the file opens correctly in Excel and try uploading again, or export as CSV.'
        );
      }
    }

    const isEncryptionError: boolean =
      error.message?.includes('Encrypted') ||
      error.message?.includes('EncryptionInfo') ||
      error.message?.includes('encryption');

    if (isEncryptionError && !isCsv && !isZipStructureError) {
      logger.info('supportplane.l1_transcript.ingestion.decrypt.start', {});

      if (password !== undefined) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_1', { strategy: 1 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer, {
            password: password || undefined,
          });
          const decryptedBuffer = await xlsxPopulateWorkbook.outputAsync();
          workbook = XLSX.read(decryptedBuffer, { type: 'buffer' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 1 });
        } catch (decryptError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 1 }, { error: decryptError as Error });
        }
      }

      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_2', { strategy: 2 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer, { password: '' });
          const decryptedBuffer = await xlsxPopulateWorkbook.outputAsync();
          workbook = XLSX.read(decryptedBuffer, { type: 'buffer' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 2 });
        } catch (decryptError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 2 }, { error: decryptError as Error });
        }
      }

      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_3', { strategy: 3 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer);
          const decryptedBuffer = await xlsxPopulateWorkbook.outputAsync();
          workbook = XLSX.read(decryptedBuffer, { type: 'buffer' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 3 });
        } catch (decryptError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 3 }, { error: decryptError as Error });
        }
      }

      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_4', { strategy: 4 });
        try {
          workbook = XLSX.read(buffer, { type: 'buffer', password: password || '' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 4 });
        } catch (xlsxPasswordError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 4 }, { error: xlsxPasswordError as Error });
        }
      }

      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_5', { strategy: 5 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer);
          const firstSheet = xlsxPopulateWorkbook.sheet(0);
          const csvContent: any[][] = (firstSheet.usedRange()?.value() as any[][]) || [];
          const csvString: string = csvContent
            .map((row) =>
              row
                .map((cell: any) => {
                  const val: string = String(cell || '');
                  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return `"${val.replace(/"/g, '""')}"`;
                  }
                  return val;
                })
                .join(',')
            )
            .join('\n');
          workbook = XLSX.read(csvString, { type: 'string', raw: true });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 5 });
        } catch (csvError) {
          logger.error('supportplane.l1_transcript.ingestion.decrypt.csv_failed', {}, { error: csvError as Error });
          throw new Error(
            'Unable to decrypt or convert this xlsx file. The file appears to be encrypted or protected. ' +
              'Please remove the encryption/protection in Excel or export as CSV and try again.'
          );
        }
      }
    } else {
      logger.error('supportplane.l1_transcript.ingestion.parse.failed', { message: error.message });
      throw new Error(`Failed to parse file: ${error.message}`);
    }
  }

  const firstSheetName: string | undefined = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File has no sheets');
  }

  const sheet: XLSX.WorkSheet = workbook.Sheets[firstSheetName];
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

  if (rawData.length < 2) {
    throw new Error('File has no data rows');
  }

  const firstRow: any[] = rawData[0] as any[];

  const looksLikeHeaders: boolean = firstRow.every((cell: any) => {
    if (!cell) return true;
    const str: string = String(cell).trim();
    return str.length < 50 && !/^[a-f0-9]{8}-[a-f0-9]{4}/i.test(str) && !(str.length > 100);
  });

  if (!looksLikeHeaders) {
    logger.warn('supportplane.l1_transcript.ingestion.no_header_row', {
      firstRowCellCount: firstRow.length,
    });
    throw new Error(
      'CSV appears to have no header row. First row looks like data, not column names. ' +
        'Please ensure the CSV has a header row with column names like "interaction_id", "shopper_id", etc.'
    );
  }

  const headersRaw: string[] = firstRow.map((h: any) => String(h).replace(/^\uFEFF/, '').trim());

  const colMap: Record<string, number> = {};
  const colMapLower: Record<string, number> = {};
  const duplicateHeaders = new Set<string>();

  headersRaw.forEach((h, i) => {
    if (h) {
      const lowerH: string = h.toLowerCase();
      if (colMapLower[lowerH] !== undefined) {
        duplicateHeaders.add(h);
      }
      colMap[h] = i;
      colMapLower[lowerH] = i;
    }
  });

  if (duplicateHeaders.size > 0) {
    logger.warn('supportplane.l1_transcript.ingestion.duplicate_headers', {
      duplicates: Array.from(duplicateHeaders),
    });
  }

  const findColumn = (name: string): number | undefined => colMapLower[name.toLowerCase()];

  logger.info('supportplane.l1_transcript.ingestion.headers', {
    columnCount: headersRaw.length,
    allHeaders: headersRaw,
    hasFullTranscript: findColumn('full_transcript') !== undefined,
    hasTranscriptViewer: findColumn('transcript_viewer') !== undefined,
  });

  const looksLikeInteractionId = (val: any): boolean => {
    if (!val) return false;
    const str: string = String(val).trim();

    if (str.includes(' ')) return false;
    if (str.length > 100) return false;
    if (str.includes('|||')) return false;
    if (/\b(agent|customer|bot):/i.test(str)) return false;
    if (/\b(yeah|okay|mhmm|sure|exactly|like|want|need|help|please|thanks)\b/i.test(str)) return false;

    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str)) {
      return true;
    }
    if (/^\d{5,}$/.test(str) || /^\d+[-_.:#]\d+/.test(str)) {
      return true;
    }
    if (str.length >= 6 && /^[A-Z0-9][-_.:#A-Z0-9]*[A-Z0-9]$/i.test(str)) {
      return true;
    }

    return false;
  };

  const interactionIdAliases: string[] = [
    'interaction_id',
    'interactionid',
    'transaction_id',
    'ticket_id',
    'id',
  ];
  let interactionIdColIdx: number | undefined;
  let interactionIdColName: string | undefined;

  for (const alias of interactionIdAliases) {
    interactionIdColIdx = findColumn(alias);
    if (interactionIdColIdx !== undefined) {
      interactionIdColName = headersRaw[interactionIdColIdx];
      break;
    }
  }

  if (interactionIdColIdx === undefined) {
    for (let i = 0; i < headersRaw.length; i++) {
      const header: string = headersRaw[i].toLowerCase();
      if (header.includes('interaction') && header.includes('id')) {
        interactionIdColIdx = i;
        interactionIdColName = headersRaw[i];
        logger.warn('supportplane.l1_transcript.ingestion.fuzzy_match_interaction_id', {
          foundColumn: headersRaw[i],
          index: i,
        });
        break;
      }
    }
  }

  if (interactionIdColIdx === undefined) {
    throw new Error(
      'Required column "interaction_id" (or alias) not found in CSV. ' +
        `Tried: ${interactionIdAliases.join(', ')}. ` +
        `Available columns: ${headersRaw.slice(0, 10).join(', ')}...`
    );
  }

  logger.info('supportplane.l1_transcript.ingestion.interaction_id_column', {
    columnIndex: interactionIdColIdx,
    columnName: interactionIdColName,
  });

  const jsonData: RawCsvRow[] = [];
  let currentRecord: any = null;
  let transcriptAccumulator: string[] = [];
  let skippedRecords = 0;
  const rejectedIds: string[] = [];

  for (let i = 1; i < rawData.length; i++) {
    const row: any[] = rawData[i] as any[];

    const hasAnyData: boolean = row.some(
      (cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== ''
    );
    if (!hasAnyData) {
      continue;
    }

    const interactionIdValue: any = row[interactionIdColIdx];

    if (looksLikeInteractionId(interactionIdValue)) {
      if (currentRecord) {
        const finalTranscript: string = transcriptAccumulator.join(' ').trim();
        currentRecord.full_transcript = finalTranscript;
        if (!finalTranscript && currentRecord.conversation_redacted_text) {
          currentRecord.full_transcript = currentRecord.conversation_redacted_text;
        }
        jsonData.push(currentRecord as RawCsvRow);
        if (transcriptAccumulator.length === 0) {
          skippedRecords++;
          logger.debug('supportplane.l1_transcript.ingestion.empty_transcript', {
            interaction_id: String(currentRecord.interaction_id || '').substring(0, 50),
            rowIndex: i,
          });
        }
      }

      currentRecord = {};
      transcriptAccumulator = [];

      headersRaw.forEach((colName, colIdx) => {
        if (colName) {
          let normalizedName: string = colName.toLowerCase().replace(/\s+/g, '_');
          if (
            normalizedName.includes('interaction') &&
            normalizedName.includes('id') &&
            normalizedName !== 'interaction_id'
          ) {
            normalizedName = 'interaction_id';
          }
          currentRecord[normalizedName] = row[colIdx] || '';
        } else if (row[colIdx]) {
          currentRecord[`unnamed_${colIdx}`] = row[colIdx];
        }
      });

      const transcriptColumnNames: string[] = [
        'full_transcript',
        'conversation_redacted_text',
        'transcript',
        'conversation_text',
        'full_text',
        'redacted_text',
      ];

      const MAX_TRANSCRIPT_LENGTH = 500000;
      for (const colName of transcriptColumnNames) {
        const colIdx: number | undefined = findColumn(colName);
        if (colIdx !== undefined && row[colIdx]) {
          const transcriptVal: string = String(row[colIdx]).trim();
          if (transcriptVal) {
            if (transcriptVal.length > MAX_TRANSCRIPT_LENGTH) {
              logger.warn('supportplane.l1_transcript.ingestion.transcript_truncated', {
                originalLength: transcriptVal.length,
                truncatedTo: MAX_TRANSCRIPT_LENGTH,
              });
              transcriptAccumulator.push(transcriptVal.substring(0, MAX_TRANSCRIPT_LENGTH));
            } else {
              transcriptAccumulator.push(transcriptVal);
            }
            break;
          }
        }
      }

      const transcriptViewerIdx: number | undefined = findColumn('transcript_viewer');
      if (transcriptViewerIdx !== undefined && transcriptViewerIdx >= 0) {
        for (let j = transcriptViewerIdx + 1; j < row.length; j++) {
          const val: any = row[j];
          if (val && String(val).trim()) {
            transcriptAccumulator.push(String(val).trim());
          }
        }
      }

      if (transcriptAccumulator.length === 0) {
        let lastNamedColIdx = -1;
        for (let j = headersRaw.length - 1; j >= 0; j--) {
          if (headersRaw[j] && headersRaw[j].trim()) {
            lastNamedColIdx = j;
            break;
          }
        }
        if (lastNamedColIdx >= 0) {
          for (let j = lastNamedColIdx + 1; j < row.length; j++) {
            const val: any = row[j];
            if (val && String(val).trim()) {
              transcriptAccumulator.push(String(val).trim());
            }
          }
        }
      }
    } else if (currentRecord) {
      for (let j = 0; j < row.length; j++) {
        const val: any = row[j];
        if (val && String(val).trim()) {
          transcriptAccumulator.push(String(val).trim());
        }
      }
    } else {
      const idValueStr: string = String(interactionIdValue || '').substring(0, 50);
      if (idValueStr && !rejectedIds.includes(idValueStr)) {
        rejectedIds.push(idValueStr);
      }
    }
  }

  if (currentRecord) {
    const finalTranscript: string = transcriptAccumulator.join(' ').trim();
    currentRecord.full_transcript = finalTranscript;
    if (!finalTranscript && currentRecord.conversation_redacted_text) {
      currentRecord.full_transcript = currentRecord.conversation_redacted_text;
    }
    jsonData.push(currentRecord as RawCsvRow);
    if (transcriptAccumulator.length === 0) {
      skippedRecords++;
    }
  }

  logger.info('supportplane.l1_transcript.ingestion.rows_parsed', {
    recordCount: jsonData.length,
    sourceRowCount: rawData.length - 1,
    emptyTranscripts: skippedRecords,
    rejectedIds: rejectedIds.slice(0, 10),
  });

  if (jsonData.length === 0 && rawData.length > 1) {
    logger.error('supportplane.l1_transcript.ingestion.no_records_parsed', {
      sourceRows: rawData.length - 1,
      rejectedCount: rejectedIds.length,
      rejectedSamples: rejectedIds.slice(0, 5),
    });
    throw new Error(
      'Failed to parse any records from CSV. No values in the first column matched expected interaction_id patterns. ' +
        `Sample values: ${rejectedIds.slice(0, 3).join(', ')}. ` +
        'Expected formats: UUIDs, numeric IDs (5+ digits), or alphanumeric identifiers (6+ chars).'
    );
  }

  if (rejectedIds.length > 0) {
    logger.warn('supportplane.l1_transcript.ingestion.rejected_ids', {
      count: rejectedIds.length,
      samples: rejectedIds.slice(0, 5),
    });
  }

  return jsonData;
}

/**
 * Extract date from filename (patterns like 2026-06-11_Transcripts.csv).
 */
function extractDateFromFilename(filename: string): string | null {
  const match: RegExpMatchArray | null = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const dateStr: string = match[1];
    const date: Date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

/**
 * Safe JSON.stringify with error handling.
 */
function safeJsonStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch (error) {
    logger.warn('supportplane.l1_transcript.ingestion.json_stringify_failed', {}, { error: error as Error });
    return '{}';
  }
}

/**
 * Map CSV row to transcript record.
 */
export function mapCsvRowToTranscript(
  row: RawCsvRow,
  rowIndex: number,
  fileHash: string,
  s3Key: string | null,
  filename?: string
): TranscriptRecord {
  const excludeFromRawData = new Set<string>([
    'interaction_id',
    'shopper_id',
    'customer_id',
    'conversation_summary',
    'full_transcript',
    'conversation_redacted_text',
    'transcript',
    'conversation_text',
    'etl_build_mst_ts',
    'rpt_mst_date',
    'transcript_viewer',
    'handled_repeat_contact_platform',
    'agent_skill_raw',
    'agent_department',
    'call_type',
    'country',
  ]);

  const raw_data: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!excludeFromRawData.has(key) && value !== undefined) {
      const parsed: string | null = parseColumnValue(value);
      if (parsed !== null && typeof parsed !== 'function' && typeof parsed !== 'symbol') {
        raw_data[key] = parsed;
      }
    }
  }

  let createdAt: string | undefined = undefined;
  const csvDate: string | null = sanitizeText(row.etl_build_mst_ts);
  if (csvDate) {
    const parsed: Date = new Date(csvDate);
    if (!isNaN(parsed.getTime()) && csvDate.length >= 10) {
      createdAt = parsed.toISOString();
    }
  }
  if (!createdAt && filename) {
    const dateFromFilename: string | null = extractDateFromFilename(filename);
    if (dateFromFilename) {
      createdAt = dateFromFilename;
    }
  }

  const record: TranscriptRecord = {
    interaction_id: sanitizeText(row.interaction_id) || `generated-${uuidv4()}`,
    app_id: undefined,
    domain: undefined,
    shopper_id: sanitizeText(row.shopper_id) || 'unknown',
    customer_id: sanitizeText(row.customer_id) || undefined,
    tags: undefined,
    conversation_summary: sanitizeText(row.conversation_summary) || undefined,
    full_transcript: sanitizeText(row.full_transcript) || '',
    created_at: createdAt || undefined,
    updated_at: sanitizeText(row.rpt_mst_date) || undefined,
    ingested_at: new Date().toISOString(),
    source_s3_key: s3Key || sanitizeText(row.transcript_viewer) || undefined,
    source_file_hash: fileHash,
    xlsx_row_index: rowIndex,
    interaction_type: sanitizeText(row.handled_repeat_contact_platform) || undefined,
    interaction_status: mapResolutionToStatus(row.issue_resolution ?? null) || undefined,
    resolution_time_seconds: undefined,
    agent_name: sanitizeText(row.agent_skill_raw) || undefined,
    category: sanitizeText(row.agent_department) || undefined,
    subcategory: sanitizeText(row.call_type) || undefined,
    sentiment_score: mapSentimentToScore(row.customer_sentiment ?? null) || undefined,
    language: mapCountryToLanguage(row.country ?? null) || undefined,
    raw_data: safeJsonStringify(raw_data),
  };

  return record;
}
