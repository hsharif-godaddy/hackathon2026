/**
 * l1-transcript-ingestion.ts
 * xlsx processing and data ingestion for L1 transcripts
 */

import * as XLSX from 'xlsx';
import XlsxPopulate from 'xlsx-populate';
import { v4 as uuidv4 } from 'uuid';
import {
  sanitizeText,
  mapCountryToLanguage,
  mapSentimentToScore,
  mapResolutionToStatus,
  parseColumnValue,
  chunkArray,
} from './l1-transcript-utils';
import { logger } from './logger';

/**
 * Raw CSV row structure - flexible to handle any column set
 * Known columns are typed, but any additional columns are allowed
 */
export interface RawCsvRow {
  // Required fields
  interaction_id?: string;
  shopper_id?: string;
  full_transcript?: string;

  // Alternative transcript field names (will be normalized to full_transcript)
  conversation_redacted_text?: string;
  transcript?: string;
  conversation_text?: string;

  // Common fields (may or may not exist depending on CSV format)
  conversation_summary?: string;
  potential_preventative_action?: string;
  actionable_improvement_opportunity?: string;
  airo_product_line?: string;
  sub_intent?: string;
  issue_resolution?: string;
  customer_sentiment?: string;
  customer_sentiment_verbiage?: string;
  friction_point?: string;
  friction_point_verbiage?: string;
  inbound_volume_driver?: string;
  inbound_driver_verbiage?: string;
  sales_consultation?: string;
  conversion_signal?: string;
  related_to_known_issue?: string;
  preventable_contact?: string;
  market_region_signal?: string;
  customer_id?: string;
  etl_build_mst_ts?: string;
  rpt_mst_date?: string;
  run_id?: string;
  customer_type_name?: string;
  country?: string;
  agent_skill_raw?: string;
  handled_repeat_contact_platform?: string;
  agent_department?: string;
  call_type?: string;
  care_contact_platform?: string;
  agent_skill_level?: string;
  repeat_contact?: string;
  transcript_viewer?: string;

  // Allow any other columns
  [key: string]: string | undefined;
}

/**
 * Transcript record ready for database insert
 */
export interface TranscriptRecord {
  interaction_id: string;
  app_id?: string;
  domain?: string;
  shopper_id: string;
  customer_id?: string;
  tags?: string; // JSON
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
  raw_data?: string; // JSON
}

/**
 * Validate that buffer is a valid ZIP file (XLSX files are ZIP containers)
 */
function isValidZipFile(buffer: Buffer): boolean {
  // Check for ZIP file signature (PK\x03\x04 at start)
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * Parse xlsx or csv file and return rows
 */
export async function parseXlsxFile(buffer: Buffer, filename?: string): Promise<RawCsvRow[]> {
  // Check if it's a CSV file
  const isCsv = filename?.toLowerCase().endsWith('.csv');

  // Get password from environment if xlsx is encrypted
  const password = process.env.L1_TRANSCRIPTS_XLSX_PASSWORD;

  let workbook: XLSX.WorkBook | undefined;

  // Try standard parsing first
  try {
    logger.info('supportplane.l1_transcript.ingestion.parse.start', {});

    // For CSV files, try to detect delimiter
    if (isCsv) {
      // Read first 1000 chars to detect delimiter
      const sample = buffer.toString('utf8', 0, Math.min(1000, buffer.length));
      const commaCount = (sample.match(/,/g) || []).length;
      const semicolonCount = (sample.match(/;/g) || []).length;
      const tabCount = (sample.match(/\t/g) || []).length;

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

      // Convert semicolon/tab to comma for XLSX library
      if (delimiter !== ',') {
        const csvText = buffer.toString('utf8').replace(new RegExp(delimiter, 'g'), ',');
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

    // Check if it's a ZIP structure error (corrupted file)
    const isZipStructureError = error.message?.includes('end of central directory') ||
                                error.message?.includes('not a zip file') ||
                                error.message?.includes('invalid zip');

    // For XLSX files with ZIP structure errors, validate the file format first
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

    // Check if it's an encryption-related error
    const isEncryptionError = error.message?.includes('Encrypted') ||
                             error.message?.includes('EncryptionInfo') ||
                             error.message?.includes('encryption');

    if (isEncryptionError && !isCsv && !isZipStructureError) {
      logger.info('supportplane.l1_transcript.ingestion.decrypt.start', {});

      // Strategy 1: Try with provided password
      if (password !== undefined) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_1', { strategy: 1 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer, {
            password: password || undefined
          });
          const decryptedBuffer = await xlsxPopulateWorkbook.outputAsync();
          workbook = XLSX.read(decryptedBuffer, { type: 'buffer' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 1 });
        } catch (decryptError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 1 }, { error: decryptError as Error });
          // Continue to next strategy
        }
      }

      // Strategy 2: Try with empty password (worksheet protection, not file encryption)
      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_2', { strategy: 2 });
        try {
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer, {
            password: ''
          });
          const decryptedBuffer = await xlsxPopulateWorkbook.outputAsync();
          workbook = XLSX.read(decryptedBuffer, { type: 'buffer' });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 2 });
        } catch (decryptError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 2 }, { error: decryptError as Error });
          // Continue to next strategy
        }
      }

      // Strategy 3: Try xlsx-populate without password (might handle some protection types)
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

      // Strategy 4: Try XLSX with ignore encryption option
      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_4', { strategy: 4 });
        try {
          workbook = XLSX.read(buffer, {
            type: 'buffer',
            password: password || '',
          });
          logger.info('supportplane.l1_transcript.ingestion.decrypt.success', { strategy: 4 });
        } catch (xlsxPasswordError) {
          logger.warn('supportplane.l1_transcript.ingestion.decrypt.failed', { strategy: 4 }, { error: xlsxPasswordError as Error });
        }
      }

      // All strategies failed - try converting to CSV as last resort
      if (!workbook) {
        logger.info('supportplane.l1_transcript.ingestion.decrypt.strategy_5', { strategy: 5 });
        try {
          // Use xlsx-populate to load and export as CSV
          const xlsxPopulateWorkbook = await XlsxPopulate.fromDataAsync(buffer);
          const firstSheet = xlsxPopulateWorkbook.sheet(0);

          // Export sheet to CSV format
          const csvContent = firstSheet.usedRange()?.value() as any[][] || [];

          // Convert array of arrays to CSV string
          const csvString = csvContent.map(row =>
            row.map((cell: any) => {
              const val = String(cell || '');
              // Escape quotes and wrap in quotes if contains comma/quote/newline
              if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                return `"${val.replace(/"/g, '""')}"`;
              }
              return val;
            }).join(',')
          ).join('\n');

          // Parse the CSV string with XLSX
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
      // Not an encryption error - re-throw original error
      logger.error('supportplane.l1_transcript.ingestion.parse.failed', {
        message: error.message,
      });
      throw new Error(`Failed to parse file: ${error.message}`);
    }
  }

  // Assume first sheet
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File has no sheets');
  }

  const sheet = workbook.Sheets[firstSheetName];

  // Get raw data as array of arrays to handle column alignment manually
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

  if (rawData.length < 2) {
    throw new Error('File has no data rows');
  }

  // First row is headers - strip BOM and normalize
  const firstRow = rawData[0] as any[];

  // Heuristic: check if first row looks like headers (mostly strings, no UUIDs/long numbers)
  const looksLikeHeaders = firstRow.every((cell: any) => {
    if (!cell) return true; // Empty is OK for headers
    const str = String(cell).trim();
    // Headers are usually short text, not UUIDs or long transcript text
    return str.length < 50 && !(/^[a-f0-9]{8}-[a-f0-9]{4}/i.test(str)) && !(str.length > 100);
  });

  if (!looksLikeHeaders) {
    logger.warn('supportplane.l1_transcript.ingestion.no_header_row', {
      firstRowSample: firstRow.slice(0, 3),
    });
    throw new Error(
      'CSV appears to have no header row. First row looks like data, not column names. ' +
      'Please ensure the CSV has a header row with column names like "interaction_id", "shopper_id", etc.'
    );
  }

  const headersRaw = firstRow.map((h: any) => {
    // Strip BOM (U+FEFF) and whitespace
    return String(h).replace(/^\uFEFF/, '').trim();
  });

  // Create case-insensitive column mapping
  const colMap: Record<string, number> = {};
  const colMapLower: Record<string, number> = {};
  const duplicateHeaders = new Set<string>();

  headersRaw.forEach((h, i) => {
    if (h) {
      const lowerH = h.toLowerCase();

      // Detect duplicates
      if (colMapLower[lowerH] !== undefined) {
        duplicateHeaders.add(h);
      }

      colMap[h] = i;  // Original case (last occurrence wins)
      colMapLower[lowerH] = i;  // Lowercase for lookups
    }
  });

  if (duplicateHeaders.size > 0) {
    logger.warn('supportplane.l1_transcript.ingestion.duplicate_headers', {
      duplicates: Array.from(duplicateHeaders),
    });
  }

  // Helper to find column by case-insensitive name
  const findColumn = (name: string): number | undefined => {
    return colMapLower[name.toLowerCase()];
  };

  logger.info('supportplane.l1_transcript.ingestion.headers', {
    columnCount: headersRaw.length,
    allHeaders: headersRaw,
    hasFullTranscript: findColumn('full_transcript') !== undefined,
    hasTranscriptViewer: findColumn('transcript_viewer') !== undefined,
    fullTranscriptIndex: findColumn('full_transcript'),
    transcriptViewerIndex: findColumn('transcript_viewer'),
  });

  // Helper: Check if a value looks like a valid interaction_id
  const looksLikeInteractionId = (val: any): boolean => {
    if (!val) return false;
    const str = String(val).trim();

    // CRITICAL: IDs should never contain spaces - indicates transcript overflow
    if (str.includes(' ')) return false;

    // Reject if too long or contains transcript markers
    if (str.length > 100) return false;
    if (str.includes('|||')) return false;
    if (/\b(agent|customer|bot):/i.test(str)) return false;

    // Reject if contains common words (transcript data)
    if (/\b(yeah|okay|mhmm|sure|exactly|like|want|need|help|please|thanks)\b/i.test(str)) return false;

    // Accept specific patterns:
    // 1. UUID format (exact match)
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str)) {
      return true;
    }

    // 2. Numeric ID (at least 5 digits, may include separators)
    if (/^\d{5,}$/.test(str) || /^\d+[-_.:#]\d+/.test(str)) {
      return true;
    }

    // 3. Alphanumeric with separators (e.g., TXN-20260601-001, ABC123, ID:12345)
    // Must be at least 6 chars and contain alphanumeric + optional separators
    if (str.length >= 6 && /^[A-Z0-9][-_.:#A-Z0-9]*[A-Z0-9]$/i.test(str)) {
      return true;
    }

    return false;
  };

  // Find the interaction_id column index (try multiple common names)
  const interactionIdAliases = ['interaction_id', 'interactionid', 'transaction_id', 'ticket_id', 'id'];
  let interactionIdColIdx: number | undefined;
  let interactionIdColName: string | undefined;

  // First try exact match
  for (const alias of interactionIdAliases) {
    interactionIdColIdx = findColumn(alias);
    if (interactionIdColIdx !== undefined) {
      interactionIdColName = headersRaw[interactionIdColIdx];
      break;
    }
  }

  // If no exact match, try fuzzy match (contains "interaction" and "id")
  if (interactionIdColIdx === undefined) {
    for (let i = 0; i < headersRaw.length; i++) {
      const header = headersRaw[i].toLowerCase();
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

  // Parse rows with multi-row record support
  const jsonData: RawCsvRow[] = [];
  let currentRecord: any = null;
  let transcriptAccumulator: string[] = [];
  let skippedRecords = 0;
  const rejectedIds: string[] = [];

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] as any[];

    // Skip completely empty rows
    const hasAnyData = row.some((cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasAnyData) {
      continue;
    }

    const interactionIdValue = row[interactionIdColIdx]; // Use correct column!

    // Check if this row starts a new record
    if (looksLikeInteractionId(interactionIdValue)) {
      // Save previous record if exists
      if (currentRecord) {
        // Store the accumulated transcript in the standard field
        const finalTranscript = transcriptAccumulator.join(' ').trim();
        currentRecord.full_transcript = finalTranscript;

        // Also normalize alternative transcript column names to full_transcript
        if (!finalTranscript && currentRecord.conversation_redacted_text) {
          currentRecord.full_transcript = currentRecord.conversation_redacted_text;
        }

        jsonData.push(currentRecord as RawCsvRow);

        // Log if transcript is missing
        if (transcriptAccumulator.length === 0) {
          skippedRecords++;
          logger.debug('supportplane.l1_transcript.ingestion.empty_transcript', {
            interaction_id: String(currentRecord.interaction_id || '').substring(0, 50),
            rowIndex: i,
          });
        }
      }

      // Start new record
      currentRecord = {};
      transcriptAccumulator = [];

      // Map column data - normalize field names to lowercase for consistency
      headersRaw.forEach((colName, colIdx) => {
        if (colName) {
          let normalizedName = colName.toLowerCase().replace(/\s+/g, '_');

          // Fix common corrupted column names
          if (normalizedName.includes('interaction') && normalizedName.includes('id') && normalizedName !== 'interaction_id') {
            // e.g., "checinteraction_id" -> "interaction_id"
            normalizedName = 'interaction_id';
          }

          currentRecord[normalizedName] = row[colIdx] || '';
        } else if (row[colIdx]) {
          // Unnamed column with data - store as unnamed_N
          currentRecord[`unnamed_${colIdx}`] = row[colIdx];
        }
      });

      // Strategy 1: Check if transcript column exists and has data
      // Try multiple common transcript column names
      const transcriptColumnNames = [
        'full_transcript',
        'conversation_redacted_text',
        'transcript',
        'conversation_text',
        'full_text',
        'redacted_text',
      ];

      const MAX_TRANSCRIPT_LENGTH = 500000; // 500KB per transcript
      let foundTranscript = false;
      for (const colName of transcriptColumnNames) {
        const colIdx = findColumn(colName);
        if (colIdx !== undefined && row[colIdx]) {
          const transcriptVal = String(row[colIdx]).trim();
          if (transcriptVal) {
            // Safety check: limit transcript size
            if (transcriptVal.length > MAX_TRANSCRIPT_LENGTH) {
              logger.warn('supportplane.l1_transcript.ingestion.transcript_truncated', {
                originalLength: transcriptVal.length,
                truncatedTo: MAX_TRANSCRIPT_LENGTH,
              });
              transcriptAccumulator.push(transcriptVal.substring(0, MAX_TRANSCRIPT_LENGTH));
            } else {
              transcriptAccumulator.push(transcriptVal);
            }
            foundTranscript = true;
            break; // Use first matching column
          }
        }
      }

      // Strategy 2: Find transcript starting column (after transcript_viewer)
      const transcriptViewerIdx = findColumn('transcript_viewer');
      if (transcriptViewerIdx !== undefined && transcriptViewerIdx >= 0) {
        // Collect transcript from columns after transcript_viewer
        for (let j = transcriptViewerIdx + 1; j < row.length; j++) {
          const val = row[j];
          if (val && String(val).trim()) {
            transcriptAccumulator.push(String(val).trim());
          }
        }
      }

      // Strategy 3: If still no transcript, collect from unnamed trailing columns
      // This handles CSVs where transcript is split across many unnamed columns
      if (transcriptAccumulator.length === 0) {
        // Find the last named column
        let lastNamedColIdx = -1;
        for (let j = headersRaw.length - 1; j >= 0; j--) {
          if (headersRaw[j] && headersRaw[j].trim()) {
            lastNamedColIdx = j;
            break;
          }
        }

        // Collect from columns after the last named one
        if (lastNamedColIdx >= 0) {
          for (let j = lastNamedColIdx + 1; j < row.length; j++) {
            const val = row[j];
            if (val && String(val).trim()) {
              transcriptAccumulator.push(String(val).trim());
            }
          }
        }
      }

      if (i === 1) {
        logger.info('supportplane.l1_transcript.ingestion.first_record_detected', {
          interaction_id: String(currentRecord.interaction_id || '').substring(0, 30),
          shopper_id: currentRecord.shopper_id,
          full_transcript_from_column: String(currentRecord.full_transcript || '').substring(0, 100),
          transcript_accumulator: transcriptAccumulator.join(' ').substring(0, 100),
          rowData: Object.keys(currentRecord).filter(k => currentRecord[k]).slice(0, 15),
        });
      }
    } else {
      // Continuation row - accumulate all non-empty cells as transcript
      if (currentRecord) {
        for (let j = 0; j < row.length; j++) {
          const val = row[j];
          if (val && String(val).trim()) {
            transcriptAccumulator.push(String(val).trim());
          }
        }
      } else {
        // Row doesn't look like an interaction_id and we have no current record
        // This is a skipped row - might be a valid ID that didn't match our heuristic
        const idValueStr = String(interactionIdValue || '').substring(0, 50);
        if (idValueStr && !rejectedIds.includes(idValueStr)) {
          rejectedIds.push(idValueStr);
        }
      }
    }
  }

  // Don't forget the last record
  if (currentRecord) {
    const finalTranscript = transcriptAccumulator.join(' ').trim();
    currentRecord.full_transcript = finalTranscript;

    // Also normalize alternative transcript column names to full_transcript
    if (!finalTranscript && currentRecord.conversation_redacted_text) {
      currentRecord.full_transcript = currentRecord.conversation_redacted_text;
    }

    jsonData.push(currentRecord as RawCsvRow);

    if (transcriptAccumulator.length === 0) {
      skippedRecords++;
      logger.debug('supportplane.l1_transcript.ingestion.empty_transcript', {
        interaction_id: String(currentRecord.interaction_id || '').substring(0, 50),
        rowIndex: rawData.length - 1,
      });
    }
  }

  logger.info('supportplane.l1_transcript.ingestion.rows_parsed', {
    recordCount: jsonData.length,
    sourceRowCount: rawData.length - 1,
    emptyTranscripts: skippedRecords,
    rejectedIds: rejectedIds.slice(0, 10), // Show first 10 rejected IDs
  });

  // Error if no records were parsed
  if (jsonData.length === 0 && rawData.length > 1) {
    logger.error('supportplane.l1_transcript.ingestion.no_records_parsed', {
      sourceRows: rawData.length - 1,
      rejectedCount: rejectedIds.length,
      rejectedSamples: rejectedIds.slice(0, 5),
    });
    throw new Error(
      `Failed to parse any records from CSV. No values in the first column matched expected interaction_id patterns. ` +
      `Sample values: ${rejectedIds.slice(0, 3).join(', ')}. ` +
      `Expected formats: UUIDs, numeric IDs (5+ digits), or alphanumeric identifiers (6+ chars).`
    );
  }

  // Warn if we rejected many potential IDs
  if (rejectedIds.length > 0) {
    logger.warn('supportplane.l1_transcript.ingestion.rejected_ids', {
      count: rejectedIds.length,
      samples: rejectedIds.slice(0, 5),
      hint: 'These values in column 0 did not match interaction_id patterns. If these are valid IDs, the pattern detection may need adjustment.',
    });
  }

  return jsonData;
}

/**
 * Extract date from filename
 * Patterns: 2026-06-11_Transcripts.csv, transcripts_2026-06-11.csv, etc.
 */
function extractDateFromFilename(filename: string): string | null {
  // Match YYYY-MM-DD pattern
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    // Validate it's a reasonable date
    const dateStr = match[1];
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

/**
 * Map CSV row to transcript record
 */
export function mapCsvRowToTranscript(
  row: RawCsvRow,
  rowIndex: number,
  fileHash: string,
  s3Key: string | null,
  filename?: string
): TranscriptRecord {
  // Store all columns in raw_data except the ones we map to specific fields
  const excludeFromRawData = new Set([
    'interaction_id',
    'shopper_id',
    'customer_id',
    'conversation_summary',
    'full_transcript',
    'conversation_redacted_text', // Alternative transcript field
    'transcript', // Alternative transcript field
    'conversation_text', // Alternative transcript field
    'etl_build_mst_ts',
    'rpt_mst_date',
    'transcript_viewer',
    'handled_repeat_contact_platform',
    'agent_skill_raw',
    'agent_department',
    'call_type',
    'country',
    // NOTE: issue_resolution and customer_sentiment MUST remain in raw_data
    // because analytics queries (e.g., Issue Resolution Methods chart) look for them there
  ]);

  const raw_data: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!excludeFromRawData.has(key) && value !== undefined) {
      const parsed = parseColumnValue(value);
      // Ensure value is JSON-serializable (no functions, symbols, etc.)
      if (parsed !== null && typeof parsed !== 'function' && typeof parsed !== 'symbol') {
        raw_data[key] = parsed;
      }
    }
  }

  // Parse created_at from CSV column or filename
  let createdAt: string | undefined = undefined;
  const csvDate = sanitizeText(row.etl_build_mst_ts);

  // Validate CSV date - must be ISO format or parseable as date
  if (csvDate) {
    const parsed = new Date(csvDate);
    if (!isNaN(parsed.getTime()) && csvDate.length >= 10) {
      createdAt = parsed.toISOString();
    }
  }

  // Fallback to filename date if CSV date is invalid
  if (!createdAt && filename) {
    const dateFromFilename = extractDateFromFilename(filename);
    if (dateFromFilename) {
      createdAt = dateFromFilename;
    }
  }

  const record: TranscriptRecord = {
    interaction_id: sanitizeText(row.interaction_id) || `generated-${uuidv4()}`,
    app_id: undefined, // Will be extracted by AI
    domain: undefined, // Will be extracted by AI
    shopper_id: sanitizeText(row.shopper_id) || 'unknown',
    customer_id: sanitizeText(row.customer_id) || undefined,
    tags: undefined, // NULL - will be populated by AI tagging (NULL = not yet analyzed)
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

/**
 * Safe JSON.stringify with error handling
 */
function safeJsonStringify(data: any): string {
  try {
    return JSON.stringify(data);
  } catch (error) {
    logger.warn('supportplane.l1_transcript.ingestion.json_stringify_failed', {}, { error: error as Error });
    // Return minimal valid JSON
    return '{}';
  }
}

/**
 * Process batch of rows in parallel
 */
export async function processBatch(
  rows: RawCsvRow[],
  batchIndex: number,
  fileHash: string,
  s3Key: string | null,
  insertFn: (records: any[]) => Promise<{ inserted: number; skipped: number }>,
  filename?: string
): Promise<{ processed: number; inserted: number; skipped: number; errors: number }> {
  const startRowIndex = batchIndex * rows.length;

  try {
    const records = rows.map((row, i) =>
      mapCsvRowToTranscript(row, startRowIndex + i, fileHash, s3Key, filename)
    );

    const insertResult = await insertFn(records);

    return {
      processed: records.length,
      inserted: insertResult.inserted,
      skipped: insertResult.skipped,
      errors: 0,
    };
  } catch (error) {
    logger.error('supportplane.l1_transcript.ingestion.batch.failed', { batchIndex }, { error: error as Error });
    return { processed: 0, inserted: 0, skipped: 0, errors: rows.length };
  }
}

/**
 * Process all rows with parallel batch processing
 * Strategy: 5 concurrent batches of 50 rows
 */
export async function processAllRows(
  rows: RawCsvRow[],
  fileHash: string,
  s3Key: string | null,
  insertFn: (records: any[]) => Promise<{ inserted: number; skipped: number }>,
  filename?: string
): Promise<{ total: number; processed: number; inserted: number; skipped: number; errors: number }> {
  const BATCH_SIZE = 50;
  const CONCURRENT_BATCHES = 5;

  const batches = chunkArray(rows, BATCH_SIZE);

  let totalProcessed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process batches in groups of CONCURRENT_BATCHES
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const batchGroup = batches.slice(i, i + CONCURRENT_BATCHES);

    const results = await Promise.all(
      batchGroup.map((batch, groupIndex) =>
        processBatch(batch, i + groupIndex, fileHash, s3Key, insertFn, filename)
      )
    );

    results.forEach(result => {
      totalProcessed += result.processed;
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    });
  }

  return {
    total: rows.length,
    processed: totalProcessed,
    inserted: totalInserted,
    skipped: totalSkipped,
    errors: totalErrors,
  };
}
