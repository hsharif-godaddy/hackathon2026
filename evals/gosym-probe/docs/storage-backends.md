# Baseline storage (local default, opt-in S3 sharing)

gosym-probe gates each run against **baselines** — the captured scores a run is
compared against. Generating them burns the most time (high trial counts), so
baselines are worth sharing across devs and CI rather than regenerating on every
machine. S3 is the shared store for that (squad task 1c.i).

S3 is **not** an alternate backend you choose between. Local disk is always the
default. A specific command opts into the shared bucket with `--s3`:

- `pnpm run eval --s3` — **read-only.** Reads the latest baseline per scenario
  **from S3** for the regression gate; never writes. A missing baseline here is
  treated as a hard error (not a skipped gate) — see "Reads fail closed" below.
- `pnpm run save-baseline <run-id> --s3` — **the sole S3 write path.** Manually
  push a clean, ready baseline **to S3**. Manual by design: only vetted
  baselines should become the shared gating source of truth.

`--s3` is **rejected** with `--graduate` / `--graduate-suite` (the run exits with
an error). A graduation is an N-trial stability pass that's routinely redone with
`--resume` after dropped or timed-out trials, so auto-publishing its baseline to
the shared bucket would be fragile and hard to reason about. Graduate to the
local tree, confirm the result, then promote it deliberately with
`save-baseline <run-id> --s3`.

Without `--s3`, everything reads and writes the local working tree exactly as
before — no config, no AWS, no behavior change for local dev.

## Reads fail closed on the shared store

`eval --s3` gates against S3 baselines, so a *missing* baseline is dangerous: if
it were treated as "no baseline → skip the gate," a wrong `storage.s3.prefix` or
a list-scoped credential would silently skip the regression gate for every
scenario and the CI job would go green (a false green). So under `--s3` a missing
per-scenario baseline is a **hard error**, not a skipped gate. A genuinely-new
scenario must get its first baseline pushed explicitly with `save-baseline --s3`;
absence is never inferred as "new" on the shared store. Local
runs keep the lenient behaviour (a missing baseline just warns and skips the
gate) because a new scenario with no baseline yet is a normal local-dev state.

## Run artifacts are NOT in S3

Only baseline JSON goes through this seam. The per-run output tree under `runs/`
(transcripts, snapshots, reports) stays on local disk. Sharing one run's
evidence — e.g. a 1d merge-back report — is better served by attaching it to the
PR or keeping it as a CI (GitHub Actions) artifact, which keeps the discussion in
the GitHub environment and avoids paying for S3 storage that auto-expires anyway.
Local `runs/` pruning (`storage.maxRuns`, default keep-10) is unchanged.

## Configuration

`--s3` needs the bucket connection config under the eval `config` `storage`
block (see `config/environments/types.ts`):

```jsonc
{
  "storage": {
    "maxRuns": 10,                          // local run-dir pruning (unrelated to S3)
    "s3": {
      "bucket": "my-eval-bucket",           // required for --s3
      "prefix": "evals/gosym-probe",        // optional key prefix
      "region": "us-west-2"                 // optional; defaults us-west-2
    }
  }
}
```

Passing `--s3` with no `s3.bucket` configured throws at startup (fail loud, not
a silent write-to-nowhere). Omitting `--s3` ignores the `s3` block entirely.

## AWS credentials

The S3 client uses the standard AWS SDK credential chain (env vars → shared
config/`~/.aws` → instance role). No credentials live in the harness.

- **Local:** `AWS_PROFILE=airobuild-dev-private-sso pnpm run eval --s3 ...` (the
  same profile the GoCode S2S path uses). Pitfall: any `AWS_PROFILE` already
  exported in your shell shadows this inline value — `tsx --env-file` does not
  override an already-set env var — so unset a stale one first.
- **CI:** the runner's IAM role. Read access (`s3:GetObject`, `s3:ListBucket`)
  is mandatory for gating; write (`s3:PutObject`) only for the baseline-push
  step.

## Lifecycle / expiry

Baselines are the shared gating source of truth — a lifecycle rule silently
deleting one would break `--s3` gating with no warning. So **do not** put a
destructive expiry on the baseline prefix (keep them indefinitely, or cap by
retaining the last N per scenario). If run-evidence artifacts are ever stored in
S3 later, they belong under a **separate** prefix with a short TTL (1–3 months);
they're debugging artifacts, not gating inputs.

## Storage miss — behaviour differs by backend

Behaviour on a missing baseline depends on the backend, by design:

- **`--s3` (shared gating store): hard error, never a skipped gate.** See "Reads
  fail closed on the shared store" above — a miss on S3 throws rather than
  skipping, so a wrong prefix / list-scoped credential can't produce a
  false-green CI run.
- **Local (default): skipped gate with a warning.** A missing baseline on the
  local tree is a normal state (a new scenario with no baseline yet), so the
  regression gate is **skipped**, not passed, and a `warnLine`
  ("Baseline not found — regression gate NOT applied …") makes the skip visible
  in the logs rather than reading as a silent pass.

In both backends, only the bare object-absence path (`NoSuchKey` on S3, `ENOENT`
locally) counts as "no baseline yet"; bucket-level faults (`NoSuchBucket`,
`AccessDenied`) always throw rather than masquerade as a miss.

## Architecture

Baselines are written through a small `FileStore` seam (`src/storage/`):
`LocalFileStore` (default) and `S3FileStore` implement one path-keyed interface;
`createFileStore(config, useS3)` selects one from the `--s3` flag. `BaselineStore`
takes an injected `FileStore`, so the same save/load/gating code targets local
disk or S3 unchanged. The S3 impl honours the local backend's null-on-miss
contract (`ENOENT` → `null` locally, `NoSuchKey` → `null` on S3) and emulates
`readdir` via a delimited, paginated `ListObjectsV2`.
