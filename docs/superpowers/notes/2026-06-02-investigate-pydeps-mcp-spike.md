# Spike: Python deps (code-review-graph + drain3) + MCP entrypoint on the investigator Lambda image

**Date:** 2026-06-02
**Task:** 0.1 — de-risking spike for adding `code-review-graph` + `drain3` to the investigator Lambda image, and confirming the code-review-graph MCP entrypoint.
**Base image:** `public.ecr.aws/lambda/nodejs:22` (Amazon Linux 2023), digest `sha256:609a9d1f7c9bdbd9200c85af21f1f51572bc8f7aa5d5fe71bd8e9599ac933cf9`, built `linux/amd64`.

## Verdict

**Multi-stage SAME-BASE pattern: PASS — but ONLY with a one-line fix not in the original task spec.**

The exact Dockerfile in the task spec **FAILS**. It needs `ENV LD_LIBRARY_PATH=/usr/lib64` in both the build stage (so pip can reach PyPI) and the runtime stage (so the MCP server can use SSL at runtime). With that env added, the multi-stage pattern works end to end: both deps install, both import, and the MCP entrypoint is confirmed. No need to fall back to a python-base Lambda image.

The committed `investigator/docker/spike-pydeps.Dockerfile` is left **exactly as the task specified** (it fails) so the failure is reproducible; the fix is documented here and baked into the corrected `spike-mcp-smoke.sh` env. Production Dockerfile work should apply the `LD_LIBRARY_PATH=/usr/lib64` fix.

## Root cause (the interesting finding)

`dnf install python3.11` on this base installs **Python 3.11.15** and its `_ssl.cpython-311-...so` is present — but `import ssl` fails:

```
ImportError: .../_ssl.cpython-311-x86_64-linux-gnu.so:
  undefined symbol: COMP_get_type, version OPENSSL_3.0.0
```

Because pip uses Python's `ssl` to talk to PyPI over HTTPS, this surfaces in the build as:

```
SSLError("Can't connect to HTTPS URL because the SSL module is not available.")
ERROR: No matching distribution found for code-review-graph
```

Diagnosis (all confirmed in-container):

- The Lambda node base ships **its own bundled OpenSSL at `/var/lang/lib/libcrypto.so.3`** (the Node.js runtime's OpenSSL, ~24 MB) and puts `/var/lang/lib` first in the dynamic-loader search path.
- `ldd` on `_ssl.so` resolves `libcrypto.so.3` → **`/var/lang/lib/libcrypto.so.3`** (Node's), which does **not** export `COMP_get_type@OPENSSL_3.0.0`.
- The AL2023 system OpenSSL at `/usr/lib64/libcrypto.so.3` (3.5.5) **does** export `COMP_get_type@@OPENSSL_3.0.0` (confirmed via `nm -D`). python3.11's `_ssl.so` was built against that AL2023 OpenSSL.
- The base uses the snapshot-safe variant package `openssl-snapsafe-libs-3.5.5`. `dnf swap openssl-snapsafe-libs openssl-libs` succeeds but does **not** fix the import — because the loader still resolves to `/var/lang/lib`, not `/usr/lib64`. `ldconfig` is not even present in the base.
- A **stock `amazonlinux:2023`** base (NOT Lambda) runs `python3.11` + `import ssl` perfectly. So this is **Lambda-base-specific** (the `/var/lang/lib` OpenSSL shadowing `/usr/lib64`), not an AL2023 problem.

This is the same family of issue the existing `investigator/Dockerfile` already documented for the base's stripped 3.9 (`missing _sha512`), now pinned precisely for 3.11: it's a `libcrypto` symbol-versioning shadow from `/var/lang/lib`.

### The fix

Force the loader to prefer the AL2023 OpenSSL:

```dockerfile
ENV LD_LIBRARY_PATH=/usr/lib64
```

With this set, `python3.11 -c "import ssl"` prints `OpenSSL 3.5.5 27 Jan 2026`, pip reaches PyPI, and installs succeed. Verified both at build time (pip) and at runtime (MCP server will need it too).

## dnf python version

- `dnf install -y python3.11` works and provides **Python 3.11.15** (3.11, not 3.9). No fallback to `python3`/`python3-pip` was needed. (Note: the base's *default* `python3` is the stripped 3.9; we deliberately install `python3.11`, which satisfies code-review-graph's `>=3.10` requirement.)

## Import results (runtime stage, corrected build)

```
drain3 OK
crg import OK
crg submodules: ['__main__', 'analysis', 'changes', 'cli', 'communities', 'constants',
 'context_savings', 'daemon', 'daemon_cli', 'embeddings', 'enrich', 'eval', 'exports',
 'flows', 'graph', 'graph_diff', 'hints', 'incremental', 'jedi_resolver', 'main',
 'memory', 'migrations', 'parser', 'postprocessing', 'prompts', 'refactor', 'registry',
 'rescript_resolver', 'search', 'skills', 'spring_resolver', 'temporal_resolver',
 'token_benchmark', 'tools', 'tsconfig_resolver', 'visualization', 'wiki']
```

- `code-review-graph` resolved to **2.3.5**, `drain3` to **0.9.11** (installed as `drain3-0.9.11`; cachetools/jsonpickle pulled as deps). Both on PyPI under those exact names.
- drain3 0.9.11 has no wheel / no `pyproject.toml` (legacy `setup.py install`) — installs fine, just a deprecation warning.

## MCP entrypoint (pinned)

**There is NO `code_review_graph.mcp` module.** The smoke script's original `args: ["-m", "code_review_graph.mcp"]` is wrong (`No module named code_review_graph.mcp`).

The stdio MCP server is launched via the package CLI's **`serve`** (or **`mcp`**) subcommand:

- Console scripts in `/opt/py-packages/bin`: `code-review-graph`, `crg-daemon` (plus dep scripts `fastmcp`, `mcp`, `uvicorn`, `watchmedo`, etc.).
- `entry_points.txt`:
  - `code-review-graph = code_review_graph.cli:main`
  - `crg-daemon = code_review_graph.daemon_cli:main`
- CLI subcommands include: `install init build update postprocess embed watch status visualize wiki register unregister repos eval detect-changes serve mcp daemon`.
- `serve --help`: stdio by default; `--http` switches to Streamable HTTP (default `127.0.0.1:5555`); `--tools` filters exposed tools (also `CRG_TOOLS` env); `--repo` / `--auto-watch`.
- `mcp --help`: lighter stdio entry — `--repo`, `--auto-watch`.

**Recommended MCP server config (stdio):**

```json
{ "mcpServers": { "crg": {
  "command": "python3.11",
  "args": ["-m", "code_review_graph", "serve"],
  "env": { "PYTHONPATH": "/opt/py-packages", "LD_LIBRARY_PATH": "/usr/lib64" }
} } }
```

Using `python3.11 -m code_review_graph serve` (rather than the `code-review-graph` bin script) means we only depend on `PYTHONPATH`, not on `/opt/py-packages/bin` being on `PATH`. `LD_LIBRARY_PATH=/usr/lib64` is required at runtime too (the server uses httpx/SSL).

## Image size

`inv-pydeps-spike(-fixed)`: **1.21 GB** (`docker images`). Dominated by the COPY'd `/opt/py-packages` (tree-sitter language packs, fastmcp, pydantic, cryptography) + the runtime `python3.11` + `git` + claude-code CLI.

## Failed-build log tail (exact task spec, no fix)

```
#7 ... SSLError("Can't connect to HTTPS URL because the SSL module is not available.")
#7 ... Could not fetch URL https://pypi.org/simple/code-review-graph/ ...
#7 8.043 ERROR: Could not find a version that satisfies the requirement code-review-graph (from versions: none)
#7 8.043 ERROR: No matching distribution found for code-review-graph
ERROR: failed to solve: process "...pip install --target /opt/py-packages code-review-graph drain3" did not complete successfully: exit code: 1
```

Full logs: `/tmp/pydeps-spike.log` (failing spec) and `/tmp/pydeps-spike-fixed.log` (passing, with `LD_LIBRARY_PATH=/usr/lib64`).

## Deferred

The MCP tool-listing run (`investigator/docker/spike-mcp-smoke.sh`, which runs `claude -p ... --mcp-config`) is **DEFERRED** — it needs GoCode test credentials the user will supply. The script is committed for the record with the corrected entrypoint and env; it has not been executed against a live model.

## Action items for production Dockerfile work (out of scope for this spike)

1. Use the multi-stage SAME-BASE pattern (build stage `pip install --target /opt/py-packages`, runtime stage `dnf install python3.11` + COPY).
2. Set `ENV LD_LIBRARY_PATH=/usr/lib64` in BOTH stages.
3. Configure the MCP server as `python3.11 -m code_review_graph serve` with `PYTHONPATH=/opt/py-packages` and `LD_LIBRARY_PATH=/usr/lib64`.
4. Add `gcc gcc-c++ make` to the build stage only (drain3/tree-sitter native deps); keep the runtime stage lean (`python3.11 git`).
