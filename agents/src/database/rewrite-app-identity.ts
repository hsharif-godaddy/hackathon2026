/**
 * Rewrite App Identity (post-clone SQLite fix)
 *
 * After an app is cloned/restored into a NEW app ID (and usually a NEW cell), the
 * agent DB still points everywhere at the OLD app ID and OLD cell, which breaks
 * chat/preview/publish (e.g. HTTP 404 on /api/conversations/<oldId>/...). This
 * rewrites every reference in a single atomic transaction.
 *
 * WHY SCHEMA-DRIVEN: the app ID is not only stored in `app_id` foreign-key columns
 * — it is also embedded inside URLs and JSON blobs (conversation message content &
 * metadata, memory values, social post payloads, app_metadata, apps.*_url, …). A
 * hardcoded table/column list misses those, which is how old IDs get left behind
 * (see the clone-debugging thread). We instead introspect the schema and rewrite
 * EVERY text column of EVERY table, so nothing is missed and new tables/columns are
 * covered automatically. The app ID is a unique 10-char token, so a blanket
 * substring replace is safe. This rewrites EVERY preview/publish/agent URL (and any
 * other embedded reference) because those all contain the app ID.
 *
 * CELL: the cell token is short and could appear in unrelated data, so it is only
 * replaced where it sits as the DNS label before an Airo platform host suffix
 * (".<cell>.airoapp.ai", ".<cell>.test-airoapp.ai", …). This covers every URL shape
 * — publish "<app>.<cell>.<suffix>", preview "<app>.preview.<cell>.<suffix>", agent
 * "<app>.agent.<cell>.<suffix>" — across both prod and test domains, without
 * hardcoding a single domain and without touching bare cell tokens elsewhere.
 *
 * SAFETY: all writes run inside one better-sqlite3 transaction. The FK integrity
 * check and the "no old references remain" verification run BEFORE commit — if
 * either fails the transaction throws and better-sqlite3 rolls back automatically,
 * leaving the DB untouched. Callers must quiesce agent writers first (this runs
 * in-process against the live connection, so it is the agent that owns the file —
 * there is no second process, but concurrent request handlers should be paused).
 */

import type { Database } from 'better-sqlite3';

import { AIRO_HOST_SUFFIXES } from '../constants/airo-hosts.js';

/** Canonical app ID shape: 10-char lowercase alphanumeric nanoid. */
const APP_ID_RE = /^[a-z0-9]{10}$/;
/** Cell token shape, e.g. "c1", "c2". */
const CELL_RE = /^[a-z0-9]{1,16}$/;
/** Defense-in-depth guard for interpolated SQL identifiers (table/column names). */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Encrypted / authenticated-crypto columns are opaque base64 ciphertext, IVs, and
 * auth tags — they never contain a plaintext app ID, and a blind REPLACE could
 * corrupt an unrecoverable token if the ciphertext coincidentally contains the
 * app-id substring. They are excluded from the sweep.
 *
 * We match on the column-name SUFFIX (`_encrypted` / `_iv` / `_tag`) rather than
 * enumerating specific names, so any future encrypted column on any table is
 * covered automatically (the original hardcoded 6-name list would have missed a
 * new `*_encrypted` column on another table and swept its ciphertext). The
 * corresponding `*_app_id` / `app_id` FK columns do NOT match these suffixes, so
 * the foreign key still gets rewritten.
 */
const EXCLUDED_COLUMN_SUFFIXES = ['_encrypted', '_iv', '_tag'] as const;

function isExcludedColumn(column: string): boolean {
  return EXCLUDED_COLUMN_SUFFIXES.some((suffix) => column.endsWith(suffix));
}

export interface RewriteAppIdentityParams {
  /** App ID currently stored in the DB (source of the clone/restore). */
  oldAppId: string;
  /** App ID to rewrite to (the provisioned target app). */
  newAppId: string;
  /** Old cell token (e.g. "c1"). Provide BOTH cell fields or neither. */
  oldCell?: string;
  /** New cell token (e.g. "c2"). */
  newCell?: string;
  /**
   * Platform host suffixes the cell is anchored against (defaults to the Airo
   * prod/test domains). Passed through mainly for tests / future domains.
   */
  hostSuffixes?: readonly string[];
}

export interface RewriteAppIdentityReport {
  oldAppId: string;
  newAppId: string;
  oldCell: string | null;
  newCell: string | null;
  columnsScanned: number;
  /** Total row-updates applied for the app-ID replacement across all columns. */
  appIdReplacements: number;
  /** Total row-updates applied for the cell replacement across all columns. */
  cellReplacements: number;
  /** Distinct table names that had at least one row updated. */
  tablesTouched: string[];
  /**
   * True when the DB was already in the target state (no old-id/old-cell references anywhere and
   * the target row present) so nothing was rewritten. Lets a re-run of a clone that already
   * succeeded be treated as success ("nothing to do") instead of failing with source_missing.
   */
  alreadyConsistent?: boolean;
}

export type RewriteErrorCode =
  | 'invalid_app_id'
  | 'invalid_cell'
  | 'same_app_id'
  | 'cell_incomplete'
  | 'source_missing'
  | 'no_columns'
  | 'fk_violation'
  | 'verification_failed';

export class RewriteAppIdentityError extends Error {
  constructor(message: string, readonly code: RewriteErrorCode) {
    super(message);
    this.name = 'RewriteAppIdentityError';
  }
}

interface MinimalLogger {
  info: (event: string, meta?: Record<string, unknown>) => void;
  warn: (event: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: MinimalLogger = { info: () => {}, warn: () => {} };

interface ColumnRef {
  table: string;
  column: string;
}

interface CellAnchor {
  old: string;
  new: string;
}

/**
 * Build the `.<cell><suffix>` anchor pairs used to scope cell replacement — one per
 * platform host suffix. Anchoring on the suffix matches the cell in every URL shape
 * (publish/preview/agent, prod/test) without hardcoding a single domain.
 */
function buildCellAnchors(oldCell: string, newCell: string, suffixes: readonly string[]): CellAnchor[] {
  return suffixes.map((suffix) => ({
    old: `.${oldCell}${suffix}`,
    new: `.${newCell}${suffix}`,
  }));
}

/**
 * Enumerate every text-affinity column of every real (non-virtual, non-internal)
 * table, excluding encrypted token columns. Driven entirely by the live schema so
 * the sweep can never miss a table/column the hardcoded approach forgot.
 *
 * ASSUMPTION: any column that can embed an app ID / URL is declared with text
 * affinity (CHAR/CLOB/TEXT or untyped). This holds for the entire current schema.
 * Both the sweep AND the post-sweep verification use this same set, so an app ID
 * stored in a future NON-text-affinity column (e.g. NUMERIC/BLOB) would be both
 * missed and silently pass verification — declare such columns TEXT.
 */
function enumerateTextColumns(db: Database): ColumnRef[] {
  const rows = db
    .prepare(
      `SELECT m.name AS tbl, p.name AS col
       FROM sqlite_master m
       JOIN pragma_table_info(m.name) p
       WHERE m.type = 'table'
         AND m.name NOT LIKE 'sqlite_%'
         AND m.sql NOT LIKE 'CREATE VIRTUAL%'
         AND ( upper(p.type) LIKE '%CHAR%'
            OR upper(p.type) LIKE '%CLOB%'
            OR upper(p.type) LIKE '%TEXT%'
            OR p.type = '' )
       ORDER BY m.name, p.cid`
    )
    .all() as Array<{ tbl: string; col: string }>;

  const cols: ColumnRef[] = [];
  for (const { tbl, col } of rows) {
    if (isExcludedColumn(col)) continue;
    // Defense-in-depth: skip anything that is not a plain identifier so it can
    // never be interpolated unsafely into the UPDATE below.
    if (!IDENTIFIER_RE.test(tbl) || !IDENTIFIER_RE.test(col)) continue;
    cols.push({ table: tbl, column: col });
  }
  return cols;
}

/**
 * Enumerate every real table that has an `app_id` column. These are the child tables
 * keyed to a specific app (app_metadata PK app_id, app_commerce_bindings PK app_id,
 * memory UNIQUE(app_id,key), …). Used to fully clear a pre-existing target before the
 * rename claims its id — see the takeover in rewriteAppIdentity.
 */
function enumerateAppIdTables(db: Database): string[] {
  const rows = db
    .prepare(
      `SELECT m.name AS tbl
       FROM sqlite_master m
       JOIN pragma_table_info(m.name) p
       WHERE m.type = 'table'
         AND m.name NOT LIKE 'sqlite_%'
         AND m.sql NOT LIKE 'CREATE VIRTUAL%'
         AND p.name = 'app_id'`
    )
    .all() as Array<{ tbl: string }>;

  const tables: string[] = [];
  for (const { tbl } of rows) {
    if (!IDENTIFIER_RE.test(tbl)) continue;
    tables.push(tbl);
  }
  return tables;
}

function validateParams(params: RewriteAppIdentityParams): {
  oldAppId: string;
  newAppId: string;
  oldCell: string | null;
  newCell: string | null;
  cellAnchors: CellAnchor[];
} {
  const { oldAppId, newAppId } = params;
  const oldCell = params.oldCell ?? null;
  const newCell = params.newCell ?? null;
  const suffixes = params.hostSuffixes ?? AIRO_HOST_SUFFIXES;

  if (!APP_ID_RE.test(oldAppId)) {
    throw new RewriteAppIdentityError(
      `oldAppId '${oldAppId}' is not a valid app ID (expected 10 lowercase alphanumerics)`,
      'invalid_app_id'
    );
  }
  if (!APP_ID_RE.test(newAppId)) {
    throw new RewriteAppIdentityError(
      `newAppId '${newAppId}' is not a valid app ID (expected 10 lowercase alphanumerics)`,
      'invalid_app_id'
    );
  }
  if (oldAppId === newAppId) {
    throw new RewriteAppIdentityError('oldAppId and newAppId are the same', 'same_app_id');
  }

  // Cell is optional, but both-or-neither.
  if ((oldCell === null) !== (newCell === null)) {
    throw new RewriteAppIdentityError('provide both oldCell and newCell, or neither', 'cell_incomplete');
  }
  const cellAnchors: CellAnchor[] = [];
  if (oldCell !== null && newCell !== null) {
    if (!CELL_RE.test(oldCell)) {
      throw new RewriteAppIdentityError(`oldCell '${oldCell}' is not a valid cell token`, 'invalid_cell');
    }
    if (!CELL_RE.test(newCell)) {
      throw new RewriteAppIdentityError(`newCell '${newCell}' is not a valid cell token`, 'invalid_cell');
    }
    cellAnchors.push(...buildCellAnchors(oldCell, newCell, suffixes));
  }

  return { oldAppId, newAppId, oldCell, newCell, cellAnchors };
}

/**
 * Count rows anywhere in the scanned columns that still reference the old app id or any old cell
 * anchor. Short-circuits as soon as it finds one. Used both for the pre-commit verification and
 * for the "already consistent" idempotency check.
 */
function countRemainingOldRefs(
  db: Database,
  columns: ColumnRef[],
  oldAppId: string,
  cellAnchors: readonly CellAnchor[]
): number {
  for (const { table, column } of columns) {
    const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" LIKE ?`);
    if ((countStmt.get(`%${oldAppId}%`) as { n: number }).n > 0) return 1;
    for (const anchor of cellAnchors) {
      if ((countStmt.get(`%${anchor.old}%`) as { n: number }).n > 0) return 1;
    }
  }
  return 0;
}

/**
 * Rewrite all references to `oldAppId` → `newAppId` (and optionally the cell inside
 * every platform host, e.g. `.<oldCell>.airoapp.ai` → `.<newCell>.airoapp.ai`) across
 * the entire agent SQLite database. Atomic: on any inconsistency the transaction rolls
 * back and the DB is left unchanged.
 *
 * @throws RewriteAppIdentityError on validation, preflight, FK, or verification failure.
 */
export function rewriteAppIdentity(
  db: Database,
  params: RewriteAppIdentityParams,
  logger: MinimalLogger = noopLogger
): RewriteAppIdentityReport {
  const { oldAppId, newAppId, oldCell, newCell, cellAnchors } = validateParams(params);

  const columns = enumerateTextColumns(db);
  if (columns.length === 0) {
    throw new RewriteAppIdentityError('no text columns found to scan', 'no_columns');
  }

  // Preflight.
  const sourceCount = (db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(oldAppId) as { n: number }).n;
  const targetCount = (db.prepare('SELECT COUNT(*) AS n FROM apps WHERE id = ?').get(newAppId) as { n: number }).n;

  if (sourceCount === 0) {
    // No source row to rename onto the target. If nothing anywhere still references the old
    // identity AND the target row is present, the rewrite has already happened (or there was
    // never anything to do) — treat it as an idempotent success so a re-run of a clone that
    // already succeeded continues rather than failing. Only fail when old references genuinely
    // linger (a broken/partial state this function cannot repair without the source row).
    if (targetCount > 0 && countRemainingOldRefs(db, columns, oldAppId, cellAnchors) === 0) {
      logger.info('rewrite_app_identity.already_consistent', { oldAppId, newAppId });
      return {
        oldAppId,
        newAppId,
        oldCell,
        newCell,
        columnsScanned: columns.length,
        appIdReplacements: 0,
        cellReplacements: 0,
        tablesTouched: [],
        alreadyConsistent: true,
      };
    }
    throw new RewriteAppIdentityError(`no app with id '${oldAppId}' found; nothing to rewrite`, 'source_missing');
  }

  // The target id may already be present because the agent re-registers its own SITE_ID as a
  // fresh stub on the reboot between the restore and this rewrite (server/app.ts). That stub
  // holds no real content — everything real lives under the SOURCE id from the restore — so it
  // is discarded (below, inside the transaction) and the rename claims the id.
  const targetPresent = targetCount > 0;

  logger.info('rewrite_app_identity.begin', {
    oldAppId,
    newAppId,
    oldCell,
    newCell,
    targetPresent,
    cellAnchors: cellAnchors.length,
    columnsScanned: columns.length,
  });

  let appIdReplacements = 0;
  let cellReplacements = 0;
  const tablesTouched = new Set<string>();

  // FK enforcement must be toggled OUTSIDE a transaction (no-op inside one). We
  // disable it so the PK rewrite and child-column rewrites can happen in any order;
  // the foreign_key_check below proves consistency before we commit.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');

  try {
    const apply = db.transaction(() => {
      // Take over the pre-existing target so the rename can claim its id. The expected case is a
      // bare boot stub (only an `apps` row), but a re-clone over a partially-populated target can
      // carry child rows keyed to newAppId (app_metadata / app_commerce_bindings PK app_id, memory
      // UNIQUE(app_id,key), …). Those would collide on PK/UNIQUE — or silently merge — when the
      // sweep renames the SOURCE rows onto newAppId (PK/UNIQUE stay enforced even with FK off). The
      // target holds no real content (everything real lives under the SOURCE id from the restore),
      // so we clear it entirely: first every app_id-keyed child row, then the apps row itself.
      //
      // We are inside the FK-off window, so delete directly rather than relying on ON DELETE
      // CASCADE — this also works for children whose FK lacks cascade (e.g. simple_campaign — see
      // schema.ts), which a plain FK-on delete would reject with a constraint error. The pre-commit
      // foreign_key_check below still proves integrity, and keeping the deletes inside the
      // transaction makes them atomic with the sweep (they roll back together on any failure).
      if (targetPresent) {
        let childRowsDeleted = 0;
        for (const table of enumerateAppIdTables(db)) {
          const childDel = db.prepare(`DELETE FROM "${table}" WHERE app_id = ?`).run(newAppId);
          childRowsDeleted += childDel.changes;
        }
        const del = db.prepare('DELETE FROM apps WHERE id = ?').run(newAppId);
        logger.info('rewrite_app_identity.target_stub_removed', {
          newAppId,
          appsDeleted: del.changes,
          childRowsDeleted,
        });
      }

      for (const { table, column } of columns) {
        const appIdStmt = db.prepare(
          `UPDATE "${table}" SET "${column}" = REPLACE("${column}", ?, ?) WHERE "${column}" LIKE ?`
        );
        const appIdInfo = appIdStmt.run(oldAppId, newAppId, `%${oldAppId}%`);
        if (appIdInfo.changes > 0) {
          appIdReplacements += appIdInfo.changes;
          tablesTouched.add(table);
        }

        for (const anchor of cellAnchors) {
          const cellStmt = db.prepare(
            `UPDATE "${table}" SET "${column}" = REPLACE("${column}", ?, ?) WHERE "${column}" LIKE ?`
          );
          const cellInfo = cellStmt.run(anchor.old, anchor.new, `%${anchor.old}%`);
          if (cellInfo.changes > 0) {
            cellReplacements += cellInfo.changes;
            tablesTouched.add(table);
          }
        }
      }

      // Integrity check BEFORE commit — a violation means a table referencing
      // apps(id) was missed; throw to roll the whole thing back.
      const fkViolations = db.pragma('foreign_key_check') as unknown[];
      if (fkViolations.length > 0) {
        throw new RewriteAppIdentityError(
          `${fkViolations.length} foreign-key violation(s) after rewrite; rolled back`,
          'fk_violation'
        );
      }

      // Verify no old app ID / old cell anchor remains anywhere we swept.
      if (countRemainingOldRefs(db, columns, oldAppId, cellAnchors) > 0) {
        throw new RewriteAppIdentityError(
          'old app ID / cell references still present after rewrite; rolled back',
          'verification_failed'
        );
      }
    });

    apply();
  } finally {
    // Restore FK enforcement on the shared singleton connection. Guard it: a thrown
    // pragma here would otherwise supersede the primary rewrite error (fk_violation /
    // verification_failed) in the finally, and could leave foreign_keys = OFF
    // process-wide. Log and swallow so the real error propagates.
    if (fkWasOn) {
      try {
        db.pragma('foreign_keys = ON');
      } catch (restoreErr) {
        logger.warn('rewrite_app_identity.fk_restore_failed', {
          error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
        });
      }
    }
  }

  // A cell rewrite was requested but nothing matched: the exact silent no-op shape of
  // the original clone bug (old refs left behind). Surface it — the caller may have
  // passed a cell token that never appears before a platform host suffix.
  if (cellAnchors.length > 0 && cellReplacements === 0) {
    logger.warn('rewrite_app_identity.cell_no_op', {
      oldCell,
      newCell,
      hostSuffixes: cellAnchors.map((a) => a.old),
    });
  }

  const report: RewriteAppIdentityReport = {
    oldAppId,
    newAppId,
    oldCell,
    newCell,
    columnsScanned: columns.length,
    appIdReplacements,
    cellReplacements,
    tablesTouched: [...tablesTouched].sort(),
  };

  logger.info('rewrite_app_identity.success', { ...report });
  return report;
}
