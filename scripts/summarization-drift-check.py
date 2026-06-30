#!/usr/bin/env python3
"""Summarization drift exposure check (Tier 1 evidence).

Reads existing Loki logs to answer: do prod conversations actually reach the
drift-prone regime of the incremental-only summarizer? No quality judgement --
this measures EXPOSURE only (merge depth per app, summary-token saturation vs
cumulative originals, whether full regeneration ever fires).

Approach: server-side count_over_time/quantile_over_time over the high-volume
airo-agents stream trips Loki's ~30s timeout (502). Instead we pull the raw
completion lines (cheap log query, capped by --limit) and aggregate in Python.

Usage:
    GRAFANA_API_TOKEN=... python3 -u scripts/summarization-drift-check.py [--hours 72] [--limit 5000]

Auth: $GRAFANA_API_TOKEN (Grafana service-account token), Bearer on the Loki proxy.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

LOKI_PROXY = "https://grafana.monitoring.gd3p.tools/api/datasources/proxy/650/loki/api/v1/query_range"
ENV = "prod"


def _token():
    t = os.environ.get("GRAFANA_API_TOKEN")
    if not t:
        sys.exit("GRAFANA_API_TOKEN not set")
    return t.strip()


def fetch_lines(event_substr, start_ns, end_ns, token, limit):
    """Pull raw log lines containing event_substr; return list of parsed JSON dicts."""
    q = f'{{job="airo-agents",env="{ENV}"}} |= "{event_substr}"'
    qs = urllib.parse.urlencode({"query": q, "start": start_ns, "end": end_ns,
                                 "limit": limit, "direction": "backward"})
    req = urllib.request.Request(f"{LOKI_PROXY}?{qs}",
                                 headers={"Authorization": "Bearer " + token}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310  # nosemgrep: godaddy.python.security.packages.ssrf, python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            resp = json.load(r)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"[query failed for '{event_substr}': {e}]")
    out = []
    dropped: int = 0
    for s in resp.get("data", {}).get("result", []):
        for v in s.get("values", []):
            try:
                out.append(json.loads(v[1]))
            except (ValueError, IndexError):
                dropped += 1
    if dropped:
        print(f"  [dropped {dropped} unparseable lines for '{event_substr}']")
    return out


def quantiles(vals):
    if not vals:
        return {}
    s = sorted(vals)
    def q(p):
        return s[min(len(s) - 1, int(p * len(s)))]
    return {"n": len(s), "p50": q(0.5), "p90": q(0.9), "p95": q(0.95), "p99": q(0.99), "max": s[-1]}


def num(d, *keys):
    for k in keys:
        if k in d and isinstance(d[k], (int, float)):
            return d[k]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=72)
    ap.add_argument("--limit", type=int, default=5000)
    args = ap.parse_args()
    tok = _token()
    end_ns = int(time.time() * 1e9)
    start_ns = int((time.time() - args.hours * 3600) * 1e9)
    print(f"== summarization drift exposure : last {args.hours}h : env={ENV} : line-cap {args.limit} ==\n")

    bg = [r.get("data", {}) for r in fetch_lines("summarization.background.complete", start_ns, end_ns, tok, args.limit)]
    dlc = [r.get("data", {}) for r in fetch_lines("summarization.detailed_llm.complete", start_ns, end_ns, tok, args.limit)]
    dlb = [r.get("data", {}) for r in fetch_lines("summarization.detailed_llm.batches_complete", start_ns, end_ns, tok, args.limit)]

    # ---- volume / strategy ----
    strat = {}
    for d in bg:
        strat[d.get("strategy", "?")] = strat.get(d.get("strategy", "?"), 0) + 1
    apps = {d.get("app_id") for d in bg if d.get("app_id")}

    def cap_hint(xs: list[object]) -> str:
        return " HIT — recency-biased" if len(xs) >= args.limit else ""

    print("-- volume --")
    print(f"  background.complete lines: {len(bg)}  (cap {args.limit}{cap_hint(bg)})")
    print(f"  detailed_llm.complete: {len(dlc)}{cap_hint(dlc)}   batches_complete: {len(dlb)}{cap_hint(dlb)}   distinct apps: {len(apps)}")
    print(f"  strategy: {strat}")

    # ---- overall size: summary saturation vs cumulative originals ----
    sq = quantiles([num(d, "summaryTokens") for d in bg if num(d, "summaryTokens") is not None])
    oq = quantiles([num(d, "cumulativeOriginalTokens", "originalTokens") for d in bg
                   if num(d, "cumulativeOriginalTokens", "originalTokens") is not None])
    print("\n-- size distribution (background.complete) --")
    print(f"  {'':<20}{'n':>6}{'p50':>10}{'p90':>10}{'p95':>10}{'p99':>12}{'max':>12}")
    for label, qd in (("summaryTokens", sq), ("cumulativeOriginal", oq)):
        if qd:
            print(f"  {label:<20}{qd['n']:>6}{qd['p50']:>10}{qd['p90']:>10}{qd['p95']:>10}{qd['p99']:>12}{qd['max']:>12}")

    # ---- budget sizing: what fraction of FINAL summaries exceed candidate ceilings? ----
    # Final emitted summary size = summaryTokens (background.complete, post-strategy) and
    # totalSummaryTokens (detailed_llm batched path). An enforcement ceiling should sit where
    # re-compress fires on a small tail (true safety net), not the routine top decile.
    def pct_over(vals, thresh):
        return 100 * sum(1 for v in vals if v > thresh) / len(vals) if vals else 0.0
    sv = [num(d, "summaryTokens") for d in bg if num(d, "summaryTokens") is not None]
    tv = [num(d, "totalSummaryTokens") for d in dlb if num(d, "totalSummaryTokens") is not None]
    print("\n-- budget sizing: % of FINAL summaries OVER candidate ceiling --")
    print(f"  {'ceiling':<10}{'summaryTokens':>16}{'batched total':>16}")
    for thresh in (1800, 2000, 2200, 2400, 2500):
        print(f"  {thresh:<10}{pct_over(sv, thresh):>15.1f}%{pct_over(tv, thresh):>15.1f}%")

    # ---- merge depth PER APP (true exposure: how many apps reach depth N) ----
    # incrementalUpdateCount lives on both detailed_llm.complete and batches_complete.
    depth_by_app = {}
    merged = [(d.get("app_id"), num(d, "incrementalUpdateCount")) for d in (dlc + dlb)]
    for app, ic in merged:
        if app is None or ic is None:
            continue
        depth_by_app[app] = max(depth_by_app.get(app, 0), ic)
    maxes = sorted(depth_by_app.values(), reverse=True)
    print("\n-- merge depth per app (max incrementalUpdateCount reached) --")
    if maxes:
        print(f"  apps with depth data: {len(maxes)}   global max: {maxes[0]}")
        for thresh in (0, 1, 3, 5, 10, 20, 50):
            c = sum(1 for m in maxes if m >= thresh)
            print(f"    apps reaching depth >= {thresh:<3}: {c}  ({100*c/len(maxes):.0f}%)")
        print(f"  top 10 app depths: {maxes[:10]}")
    else:
        print("  no incrementalUpdateCount data")

    # ---- true merge depth: passes per app (NOT incrementalUpdateCount, which resets at 5) ----
    # Count dlc + dlb: detailed_llm.complete fires on single-batch path (originalTokenCount <= 12k),
    # batches_complete on multi-batch. Both represent one summarization pass. Incremental deltas are
    # typically small, so dlc dominates — counting dlb alone severely underestimates depth.
    passes: dict[str, int] = {}
    for d in dlc + dlb:
        a = d.get("app_id")
        if a:
            passes[a] = passes.get(a, 0) + 1
    pv = sorted(passes.values(), reverse=True)
    print("\n-- summarization passes per app (observed in window; true merge count) --")
    if pv:
        pq = quantiles(pv)
        print(f"  apps: {len(pv)}  p50={pq['p50']} p90={pq['p90']} p99={pq['p99']} max={pq['max']}  top10={pv[:10]}")

    # ---- regeneration: real (many batches) vs cosmetic counter-reset (~1 batch)? ----
    # Use dlc + dlb: single-batch regenerations stamp regeneratedFromScratch on detailed_llm.complete,
    # not batches_complete. dlc events omit batchCount; treat as 1 (single batch by definition).
    all_passes: list[dict[str, object]] = dlc + dlb

    def split(flag: bool) -> list[dict[str, object]]:
        return [d for d in all_passes if (d.get("regeneratedFromScratch") is True) == flag]
    print("\n-- regeneratedFromScratch: real re-read vs cosmetic reset --")
    print(f"  {'flag':<8}{'n':>6}{'batchCount p50':>16}{'batchCount p90':>16}{'batchCount max':>16}")
    for flag in (True, False):
        rows = split(flag)
        bc = quantiles([num(d, "batchCount") or 1 for d in rows])
        if bc:
            print(f"  {str(flag):<8}{bc['n']:>6}{bc['p50']:>16}{bc['p90']:>16}{bc['max']:>16}")
        else:
            print(f"  {str(flag):<8}{0:>6}{'-':>16}{'-':>16}{'-':>16}")

    # ---- size vs incrementalUpdateCount (batches_complete: totalSummaryTokens + originalTokenCount) ----
    print("\n-- size vs incrementalUpdateCount (batches_complete) --")
    print(f"  {'ic':<5}{'n':>6}{'p50 summ':>10}{'max summ':>10}{'p50 orig':>12}{'max orig':>14}")
    for ic_val in range(0, 6):
        rows = [d for d in dlb if num(d, "incrementalUpdateCount") == ic_val]
        if not rows:
            continue
        sm = quantiles([num(d, "totalSummaryTokens") for d in rows if num(d, "totalSummaryTokens") is not None])
        og = quantiles([num(d, "originalTokenCount") for d in rows if num(d, "originalTokenCount") is not None])
        print(f"  {ic_val:<5}{len(rows):>6}{sm.get('p50','-'):>10}{sm.get('max','-'):>10}"
              f"{og.get('p50','-'):>12}{og.get('max','-'):>14}")

    big_lines: list[dict[str, object]] = fetch_lines("conversation.history.summary_too_large", start_ns, end_ns, tok, args.limit)
    big: int = len(big_lines)
    print("\n-- safety signals --")
    print(f"  regeneratedFromScratch=true: {sum(1 for d in all_passes if d.get('regeneratedFromScratch') is True)} / {len(all_passes)} passes (dlc+dlb)")
    print(f"  summary_too_large warnings: {big}{cap_hint(big_lines)}")


if __name__ == "__main__":
    main()
