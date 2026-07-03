/**
 * Storage seam for baseline persistence.
 *
 * Decouples *where baseline JSON lives* from *what gets written*, so the same
 * BaselineStore code can target the local filesystem (the default) or the
 * shared S3 bucket (opted into per-command via `--s3` — squad task 1c.i, so
 * CI-generated baselines outlive an ephemeral worker and are shareable). Paths
 * are opaque string keys: the local impl treats them as filesystem paths, the
 * S3 impl as object keys under a bucket/prefix.
 *
 * The surface is deliberately the minimal set BaselineStore needs — it is NOT
 * a general fs replacement. Baselines are JSON, so the write surface is
 * text-only; run-output artifacts (PNGs, transcripts) are NOT routed through
 * here (they stay on local disk / GHA artifacts, see docs/storage-backends.md).
 */
/** Which store backs a {@link FileStore} — the local working tree or the shared S3 bucket. */
export type StorageBackend = 'local' | 's3';

export interface FileStore {
  /**
   * Backend label, for operator-facing diagnostics (e.g. surfacing whether a
   * missing baseline came from local disk or the shared S3 bucket).
   */
  readonly backend: StorageBackend;
  /** Write (create or overwrite) the JSON/text object at `path`. */
  writeFile(path: string, data: string): Promise<void>;
  /**
   * Read the object at `path`, or return `null` when it does not exist.
   * Absence is a normal control-flow signal here (no baseline yet), so it
   * is surfaced as `null` rather than a thrown ENOENT.
   */
  readFile(path: string): Promise<string | null>;
  /**
   * List the immediate child names under `path`, or return `null` when the
   * directory/prefix does not exist. Names are bare (no leading path), to
   * match `fs.readdir` semantics the callers already assume.
   */
  readdir(path: string): Promise<string[] | null>;
  /**
   * Ensure the container at `path` exists (recursive). A no-op on object
   * stores that have no real directories.
   */
  mkdir(path: string): Promise<void>;
  /**
   * Human-facing, copy-pasteable location a `path` resolves to in this backend
   * — a filesystem-relative path locally, an `s3://bucket/key` URI on S3. The
   * store owns this formatting so callers can't drift from the actual key
   * derivation (e.g. prefix joining) used by {@link writeFile}.
   */
  locationFor(path: string): string;
}
