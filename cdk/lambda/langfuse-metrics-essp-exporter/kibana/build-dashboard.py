#!/usr/bin/env python3
"""
Generate a Kibana 8.x saved-objects NDJSON for the Airo Agents Operational
Health dashboard on the `langfuse-metrics-hourly` index.

Outputs `dashboard.ndjson` next to this script. Push to Kibana with:
    ./import.sh
"""

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path
from typing import Any

INDEX = "langfuse-metrics-hourly"
DATA_VIEW_ID = INDEX
DASHBOARD_ID = "lf-agents-ops"
CORE_MIG = "8.8.0"
LENS_MIG = "8.9.0"
DASH_MIG = "8.9.0"
PANEL_VERSION = "8.9.0"


# ---------------------------------------------------------------------------
# Runtime fields (Painless)
# ---------------------------------------------------------------------------

def _painless(script: str) -> dict[str, Any]:
    return {"source": textwrap.dedent(script).strip()}


KW_RUNTIME_FIELDS: dict[str, dict[str, Any]] = {
    "category": {
        "type": "keyword",
        "script": _painless(r"""
            if (doc['name'].size() == 0 || doc['observation_type'].size() == 0) { return; }
            def n = doc['name'].value;
            def t = doc['observation_type'].value;
            if (n.startsWith('agent-') && n.contains(':ai.streamText')) { emit('agent_stream'); return; }
            if (n.startsWith('agent-') && n.contains(':ai.generateText')) { emit('agent_oneshot'); return; }
            if (n.startsWith('tool-') && n.contains(':ai.')) { emit('tool_llm'); return; }
            if (t == 'GENERATION') { emit('feature_llm'); return; }
            if (n.startsWith('invoke_agent ') || n.contains('Documentation Retrieval')) { emit('system_span'); return; }
            if (t == 'SPAN') { emit('tool_span'); return; }
        """),
    },
    "agent_name": {
        "type": "keyword",
        "script": _painless(r"""
            if (doc['name'].size() == 0) { return; }
            def n = doc['name'].value;
            def m = /^agent-(.+):ai\.(stream|generate)Text\..*$/.matcher(n);
            if (m.matches()) { emit(m.group(1)); }
        """),
    },
    "tool_name": {
        "type": "keyword",
        "script": _painless(r"""
            if (doc['name'].size() == 0 || doc['observation_type'].size() == 0) { return; }
            def n = doc['name'].value;
            def t = doc['observation_type'].value;
            if (n.startsWith('tool-')) {
                def m = /^tool-(.+):.*$/.matcher(n);
                if (m.matches()) { emit(m.group(1)); return; }
            }
            if (t == 'SPAN' && !n.startsWith('agent-') && !n.startsWith('tool-')
                && !n.startsWith('invoke_agent ') && !n.contains('Documentation Retrieval')) {
                emit(n);
            }
        """),
    },
    "provider": {
        "type": "keyword",
        "script": _painless(r"""
            if (doc['model'].size() == 0) { return; }
            def m = doc['model'].value;
            if (m.startsWith('azure/')) { emit('azure'); return; }
            if (m.contains('claude')) { emit('anthropic'); return; }
            if (m.contains('gpt')) { emit('openai'); return; }
            emit('other');
        """),
    },
}

# Numeric runtime fields enabling weighted averages: sum(field_x_count) / sum(count)
NUM_RUNTIME_FIELDS: dict[str, dict[str, Any]] = {
    name: {
        "type": "double",
        "script": _painless(f"""
            if (doc['{src}'].size() == 0 || doc['count'].size() == 0) {{ return; }}
            emit(doc['{src}'].value * doc['count'].value);
        """),
    }
    for name, src in [
        ("latency_avg_x_count", "latency_avg_ms"),
        ("latency_p95_x_count", "latency_p95_ms"),
        ("ttft_avg_x_count", "ttft_avg_ms"),
        ("ttft_p95_x_count", "ttft_p95_ms"),
        ("output_tps_x_count", "output_tokens_per_second"),
    ]
}

ALL_RUNTIME_FIELDS = {**KW_RUNTIME_FIELDS, **NUM_RUNTIME_FIELDS}


def data_view_object() -> dict[str, Any]:
    return {
        "id": DATA_VIEW_ID,
        "type": "index-pattern",
        "attributes": {
            "title": INDEX,
            "timeFieldName": "@timestamp",
            "runtimeFieldMap": json.dumps(ALL_RUNTIME_FIELDS),
        },
        "references": [],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": "8.0.0",
    }


# ---------------------------------------------------------------------------
# Lens panel builders
# ---------------------------------------------------------------------------

def _layer_ref(layer_id: str) -> dict[str, str]:
    return {
        "type": "index-pattern",
        "id": DATA_VIEW_ID,
        "name": f"indexpattern-datasource-layer-{layer_id}",
    }


def _date_hist(col_id: str, interval: str = "auto") -> tuple[str, dict[str, Any]]:
    return col_id, {
        "label": "@timestamp",
        "dataType": "date",
        "operationType": "date_histogram",
        "sourceField": "@timestamp",
        "isBucketed": True,
        "scale": "interval",
        "params": {"interval": interval, "includeEmptyRows": True, "dropPartials": False},
    }


def _terms(col_id: str, field: str, size: int, order_col: str | None,
           label: str | None = None, direction: str = "desc",
           order_alphabetical: bool = False) -> tuple[str, dict[str, Any]]:
    """
    Terms agg. If `order_alphabetical=True`, picks first-N alphabetically and
    sorts rows by name (good for grouping prefix-related tools). Otherwise
    picks top-N by `order_col` (a metric column id).
    """
    if order_alphabetical:
        order_by: dict[str, Any] = {"type": "alphabetical", "fallback": False}
    else:
        assert order_col, "order_col required when not alphabetical"
        order_by = {"type": "column", "columnId": order_col}
    return col_id, {
        "label": label or field,
        "dataType": "string",
        "operationType": "terms",
        "sourceField": field,
        "isBucketed": True,
        "scale": "ordinal",
        "params": {
            "size": size,
            "orderBy": order_by,
            "orderDirection": direction,
            "otherBucket": False,
            "missingBucket": False,
            "parentFormat": {"id": "terms"},
            "include": [],
            "exclude": [],
            "includeIsRegex": False,
            "excludeIsRegex": False,
        },
    }


def _sum(col_id: str, field: str, label: str) -> tuple[str, dict[str, Any]]:
    return col_id, {
        "label": label,
        "dataType": "number",
        "operationType": "sum",
        "sourceField": field,
        "isBucketed": False,
        "scale": "ratio",
        "params": {"emptyAsNull": True},
    }


def _cardinality(col_id: str, field: str, label: str) -> tuple[str, dict[str, Any]]:
    return col_id, {
        "label": label,
        "dataType": "number",
        "operationType": "unique_count",
        "sourceField": field,
        "isBucketed": False,
        "scale": "ratio",
        "params": {"emptyAsNull": True},
    }


def _max(col_id: str, field: str, label: str, fmt: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    return col_id, {
        "label": label,
        "dataType": "number",
        "operationType": "max",
        "sourceField": field,
        "isBucketed": False,
        "scale": "ratio",
        "params": {"emptyAsNull": True, **({"format": fmt} if fmt else {})},
        "customLabel": True,
    }


def _sum_part(field: str) -> dict[str, Any]:
    return {
        "label": f"Part of formula",
        "dataType": "number",
        "operationType": "sum",
        "sourceField": field,
        "isBucketed": False,
        "scale": "ratio",
        "params": {"emptyAsNull": False},
        "customLabel": True,
    }


def _math_col(label: str, ast: dict[str, Any], refs: list[str]) -> dict[str, Any]:
    return {
        "label": label,
        "dataType": "number",
        "operationType": "math",
        "isBucketed": False,
        "scale": "ratio",
        "params": {"tinymathAst": ast},
        "references": refs,
        "customLabel": True,
    }


def _wavg_cols(col_id: str, num_field: str, denom_field: str, label: str,
               divisor: float | None = None,
               fmt: dict[str, Any] | None = None) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """
    Build a Lens 'formula' column for `(sum(num) / sum(denom)) [/ divisor]`,
    fully expanded into the backing sum + math columns that Lens expects.

    Returns (columns_map, ordered_ids).
    """
    x0 = f"{col_id}X0"
    x1 = f"{col_id}X1"
    xm = f"{col_id}X2"

    div_ast = {
        "type": "function", "name": "divide",
        "args": [
            {"type": "function", "name": "add", "args": [x0, 0]},
            {"type": "function", "name": "add", "args": [x1, 0]},
        ],
    }
    if divisor is not None:
        ast = {"type": "function", "name": "divide", "args": [div_ast, divisor]}
        formula_str = f"(sum({num_field}) / sum({denom_field})) / {divisor}"
    else:
        ast = div_ast
        formula_str = f"sum({num_field}) / sum({denom_field})"

    cols: dict[str, dict[str, Any]] = {
        x0: _sum_part(num_field),
        x1: _sum_part(denom_field),
        xm: _math_col("Part of formula", ast, [x0, x1]),
        col_id: {
            "label": label,
            "dataType": "number",
            "operationType": "formula",
            "isBucketed": False,
            "scale": "ratio",
            "params": {
                "formula": formula_str,
                "isFormulaBroken": False,
                **({"format": fmt} if fmt else {}),
            },
            "references": [xm],
            "customLabel": True,
        },
    }
    return cols, [x0, x1, xm, col_id]


def _build_metric_columns(m: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[str], str]:
    """
    Returns (columns_map, ordered_ids_for_columnOrder, accessor_id).
    The accessor_id is the column that should be wired to the visualization.
    """
    if m["kind"] == "sum":
        mid, col = _sum(m["id"], m["field"], m["label"])
        return {mid: col}, [mid], mid
    if m["kind"] == "max":
        mid, col = _max(m["id"], m["field"], m["label"], m.get("fmt"))
        return {mid: col}, [mid], mid
    if m["kind"] == "cardinality":
        mid, col = _cardinality(m["id"], m["field"], m["label"])
        return {mid: col}, [mid], mid
    if m["kind"] == "wavg":
        cols, ordered = _wavg_cols(
            m["id"], m["num"], m["denom"], m["label"],
            divisor=m.get("divisor"), fmt=m.get("fmt"),
        )
        return cols, ordered, m["id"]
    raise ValueError(f"unknown metric kind {m['kind']}")


def xy(panel_id: str, title: str, *, query: str = "",
       interval: str = "auto",
       split: dict[str, Any] | None = None,
       metrics: list[dict[str, Any]],
       series_type: str = "line",
       legend: bool = True,
       y_extents: dict | None = None,
       description: str = "") -> dict[str, Any]:
    """
    Build an lnsXY panel.
    metrics: each {id, kind: sum|cardinality|wavg, ...}
    split: {field, size, label?}  -- terms always ordered by sum(count) desc
    """
    layer_id = f"ly_{panel_id}"
    columns: dict[str, dict[str, Any]] = {}
    metric_accessors: list[str] = []
    metric_column_ids: list[str] = []

    for m in metrics:
        cols, ordered, accessor = _build_metric_columns(m)
        columns.update(cols)
        metric_column_ids.extend(ordered)
        metric_accessors.append(accessor)

    bucket_ids: list[str] = []
    if split:
        order_id = f"order_{panel_id}"
        order_col = _sum(order_id, "count", "Order by calls")[1]
        columns[order_id] = order_col
        sid, scol = _terms(f"split_{panel_id}", split["field"], split.get("size", 8), order_id,
                           split.get("label"), split.get("direction", "desc"))
        columns[sid] = scol
        bucket_ids.append(sid)
        metric_column_ids = [order_id] + metric_column_ids

    ts_id, ts_col = _date_hist(f"ts_{panel_id}", interval)
    columns[ts_id] = ts_col
    bucket_ids.append(ts_id)

    column_order = bucket_ids + metric_column_ids

    layer_viz = {
        "layerId": layer_id,
        "accessors": metric_accessors,
        "seriesType": series_type,
        "layerType": "data",
        "xAccessor": ts_id,
    }
    if split:
        layer_viz["splitAccessor"] = bucket_ids[0]

    fitting = "Linear" if series_type.startswith("line") else "None"
    visualization = {
        "legend": {"isVisible": legend, "position": "right"},
        "preferredSeriesType": series_type,
        "valueLabels": "hide",
        "fittingFunction": fitting,
        "emphasizeFitting": True,
        "axisTitlesVisibilitySettings": {"x": True, "yLeft": True, "yRight": True},
        "tickLabelsVisibilitySettings": {"x": True, "yLeft": True, "yRight": True},
        "labelsOrientation": {"x": 0, "yLeft": 0, "yRight": 0},
        "gridlinesVisibilitySettings": {"x": True, "yLeft": True, "yRight": True},
        "layers": [layer_viz],
    }
    if y_extents:
        visualization["yLeftExtent"] = y_extents

    state = {
        "datasourceStates": {
            "formBased": {
                "layers": {
                    layer_id: {
                        "columns": columns,
                        "columnOrder": column_order,
                        "incompleteColumns": {},
                        "sampling": 1,
                    }
                }
            }
        },
        "visualization": visualization,
        "query": {"query": query, "language": "kuery"},
        "filters": [],
        "internalReferences": [],
        "adHocDataViews": {},
    }

    return {
        "id": panel_id,
        "type": "lens",
        "attributes": {
            "title": title,
            "description": description,
            "visualizationType": "lnsXY",
            "state": state,
        },
        "references": [_layer_ref(layer_id)],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": LENS_MIG,
    }


def horizontal_bar(panel_id: str, title: str, *, query: str = "",
                   bucket: dict[str, Any], metric: dict[str, Any],
                   description: str = "") -> dict[str, Any]:
    """Top-N horizontal bar (no time)."""
    layer_id = f"ly_{panel_id}"
    if metric["kind"] != "sum":
        raise ValueError("horizontal_bar metric must be sum")
    mid, col = _sum(metric["id"], metric["field"], metric["label"])
    columns: dict[str, dict[str, Any]] = {mid: col}

    bid, bcol = _terms(f"bk_{panel_id}", bucket["field"], bucket.get("size", 15), mid,
                       bucket.get("label"), "desc")
    columns[bid] = bcol

    layer_viz = {
        "layerId": layer_id,
        "accessors": [mid],
        "seriesType": "bar_horizontal",
        "layerType": "data",
        "xAccessor": bid,
    }
    visualization = {
        "legend": {"isVisible": False, "position": "right"},
        "preferredSeriesType": "bar_horizontal",
        "valueLabels": "show",
        "fittingFunction": "None",
        "axisTitlesVisibilitySettings": {"x": True, "yLeft": False, "yRight": True},
        "tickLabelsVisibilitySettings": {"x": True, "yLeft": True, "yRight": True},
        "labelsOrientation": {"x": 0, "yLeft": 0, "yRight": 0},
        "gridlinesVisibilitySettings": {"x": True, "yLeft": False, "yRight": True},
        "layers": [layer_viz],
    }

    state = {
        "datasourceStates": {
            "formBased": {
                "layers": {
                    layer_id: {
                        "columns": columns,
                        "columnOrder": [bid, mid],
                        "incompleteColumns": {},
                        "sampling": 1,
                    }
                }
            }
        },
        "visualization": visualization,
        "query": {"query": query, "language": "kuery"},
        "filters": [],
        "internalReferences": [],
        "adHocDataViews": {},
    }

    return {
        "id": panel_id,
        "type": "lens",
        "attributes": {
            "title": title,
            "description": description,
            "visualizationType": "lnsXY",
            "state": state,
        },
        "references": [_layer_ref(layer_id)],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": LENS_MIG,
    }


def metric_panel(panel_id: str, title: str, *, query: str,
                 metric: dict[str, Any], description: str = "") -> dict[str, Any]:
    """Single big-number stat."""
    layer_id = f"ly_{panel_id}"
    cols, ordered, accessor = _build_metric_columns(metric)

    state = {
        "datasourceStates": {
            "formBased": {
                "layers": {
                    layer_id: {
                        "columns": cols,
                        "columnOrder": ordered,
                        "incompleteColumns": {},
                        "sampling": 1,
                    }
                }
            }
        },
        "visualization": {
            "layerId": layer_id,
            "layerType": "data",
            "metricAccessor": accessor,
        },
        "query": {"query": query, "language": "kuery"},
        "filters": [],
        "internalReferences": [],
        "adHocDataViews": {},
    }

    return {
        "id": panel_id,
        "type": "lens",
        "attributes": {
            "title": title,
            "description": description,
            "visualizationType": "lnsMetric",
            "state": state,
        },
        "references": [_layer_ref(layer_id)],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": LENS_MIG,
    }


def datatable(panel_id: str, title: str, *, query: str,
              bucket: dict[str, Any], metrics: list[dict[str, Any]],
              order_by: str | None = None,
              description: str = "") -> dict[str, Any]:
    """
    Datatable. Terms agg sorts by `order_by` (a metric id) or, if not given,
    the first metric. Caller MUST pick a metric whose underlying op is a real
    aggregation (sum/max/min) — formula columns can't drive terms ordering.
    """
    layer_id = f"ly_{panel_id}"
    columns: dict[str, dict[str, Any]] = {}
    metric_accessors: list[str] = []
    metric_column_ids: list[str] = []

    for m in metrics:
        cols, ordered, accessor = _build_metric_columns(m)
        columns.update(cols)
        metric_accessors.append(accessor)
        metric_column_ids.extend(ordered)

    order_col = order_by or metric_accessors[0]
    bid, bcol = _terms(f"bk_{panel_id}", bucket["field"], bucket.get("size", 10), order_col,
                       bucket.get("label"), "desc")
    columns[bid] = bcol

    column_order = [bid] + metric_column_ids
    visible_columns = [bid] + metric_accessors

    state = {
        "datasourceStates": {
            "formBased": {
                "layers": {
                    layer_id: {
                        "columns": columns,
                        "columnOrder": column_order,
                        "incompleteColumns": {},
                        "sampling": 1,
                    }
                }
            }
        },
        "visualization": {
            "layerId": layer_id,
            "layerType": "data",
            "columns": [{"columnId": cid, "isTransposed": False} for cid in visible_columns],
        },
        "query": {"query": query, "language": "kuery"},
        "filters": [],
        "internalReferences": [],
        "adHocDataViews": {},
    }

    return {
        "id": panel_id,
        "type": "lens",
        "attributes": {
            "title": title,
            "description": description,
            "visualizationType": "lnsDatatable",
            "state": state,
        },
        "references": [_layer_ref(layer_id)],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": LENS_MIG,
    }


def heatmap(panel_id: str, title: str, *, query: str,
            y_field: str, y_size: int, y_label: str,
            metric: dict[str, Any],
            interval: str = "auto",
            y_order_alphabetical: bool = False,
            palette: dict[str, Any] | None = None,
            description: str = "") -> dict[str, Any]:
    layer_id = f"ly_{panel_id}"
    cols, ordered, mid = _build_metric_columns(metric)
    columns: dict[str, dict[str, Any]] = dict(cols)

    if y_order_alphabetical:
        yid, ycol = _terms(f"yterms_{panel_id}", y_field, y_size, None, y_label,
                           "asc", order_alphabetical=True)
        columns[yid] = ycol
        order_extras: list[str] = []
    else:
        order_id = f"order_{panel_id}"
        columns[order_id] = _sum(order_id, "count", "Order by calls")[1]
        yid, ycol = _terms(f"yterms_{panel_id}", y_field, y_size, order_id, y_label, "desc")
        columns[yid] = ycol
        order_extras = [order_id]

    xid, xcol = _date_hist(f"ts_{panel_id}", interval)
    columns[xid] = xcol

    column_order = [yid, xid] + order_extras + ordered

    state = {
        "datasourceStates": {
            "formBased": {
                "layers": {
                    layer_id: {
                        "columns": columns,
                        "columnOrder": column_order,
                        "incompleteColumns": {},
                        "sampling": 1,
                    }
                }
            }
        },
        "visualization": {
            "layerId": layer_id,
            "layerType": "data",
            "shape": "heatmap",
            "xAccessor": xid,
            "yAccessor": yid,
            "valueAccessor": mid,
            "legend": {"isVisible": True, "position": "right", "type": "heatmap_legend"},
            "gridConfig": {
                "type": "heatmap_grid",
                "isCellLabelVisible": False,
                "isYAxisLabelVisible": True,
                "isXAxisLabelVisible": True,
                "isYAxisTitleVisible": False,
                "isXAxisTitleVisible": False,
            },
            **({"palette": palette} if palette else {}),
        },
        "query": {"query": query, "language": "kuery"},
        "filters": [],
        "internalReferences": [],
        "adHocDataViews": {},
    }

    return {
        "id": panel_id,
        "type": "lens",
        "attributes": {
            "title": title,
            "description": description,
            "visualizationType": "lnsHeatmap",
            "state": state,
        },
        "references": [_layer_ref(layer_id)],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": LENS_MIG,
    }


# ---------------------------------------------------------------------------
# Panel definitions
# ---------------------------------------------------------------------------

# Common KQL fragments
LLM_ALL = "category : (agent_stream OR agent_oneshot OR tool_llm OR feature_llm)"
AGENT_LLM = "category : (agent_stream OR agent_oneshot)"
STREAM_AGENT = "category : agent_stream"
TOOL_SPAN = "category : tool_span"

PCT_FMT = {"id": "percent", "params": {"decimals": 2}}
SEC_FMT = {"id": "number", "params": {"decimals": 2, "suffix": " s"}}
DUR_MS_FMT = {"id": "duration", "params": {
    "fromUnit": "milliseconds", "toUnit": "asSeconds", "decimals": 2, "useShortSuffix": True,
}}
TPS_FMT = {"id": "number", "params": {"decimals": 1, "suffix": " tok/s"}}


# Error-rate heatmap palette: green <= 0%, orange at 10%, light red at 20%,
# full red >= 30%. Domain in fraction (Lens uses raw metric, our error rate
# formula returns 0..1).
ERR_RATE_PALETTE: dict[str, Any] = {
    "type": "palette",
    "name": "custom",
    "params": {
        "name": "custom",
        "continuity": "above",
        "rangeType": "number",
        "rangeMin": 0.0,
        "rangeMax": 0.30,
        "progression": "fixed",
        "stops": [
            {"color": "#54B399", "stop": 0.0},
            {"color": "#F1B86F", "stop": 0.10},
            {"color": "#E07569", "stop": 0.20},
            {"color": "#CC2E1F", "stop": 0.30},
        ],
        "colorStops": [
            {"color": "#54B399", "stop": 0.0},
            {"color": "#F1B86F", "stop": 0.10},
            {"color": "#E07569", "stop": 0.20},
            {"color": "#CC2E1F", "stop": 0.30},
        ],
        "steps": 4,
        "reverse": False,
    },
}


# p95 / max stats: rolling up pre-aggregated percentiles is statistically lossy.
# We use max() — surfaces worst-period tail (operational health view), instead of
# weighted_avg which would smooth spikes and under-report tail risk.
def max_lat_p95(mid: str = "m") -> dict[str, Any]:
    return {"kind": "max", "id": mid, "field": "latency_p95_ms",
            "label": "p95 latency (worst hour)", "fmt": DUR_MS_FMT}


def max_ttft_p95(mid: str = "m") -> dict[str, Any]:
    return {"kind": "max", "id": mid, "field": "ttft_p95_ms",
            "label": "TTFT p95 (worst hour)", "fmt": DUR_MS_FMT}


# Weighted-avg formulas: mathematically correct for linear stats (avg, error rate).
def w_lat_avg(mid: str = "m") -> dict[str, Any]:
    return {"kind": "wavg", "id": mid, "num": "latency_avg_x_count", "denom": "count",
            "divisor": 1000, "label": "avg latency (s)", "fmt": SEC_FMT}


def w_out_tps(mid: str = "m") -> dict[str, Any]:
    return {"kind": "wavg", "id": mid, "num": "output_tps_x_count", "denom": "count",
            "label": "tokens/sec", "fmt": TPS_FMT}


def w_error_rate(mid: str = "m") -> dict[str, Any]:
    return {"kind": "wavg", "id": mid, "num": "error_count", "denom": "count",
            "label": "Error rate", "fmt": PCT_FMT}


def panels() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # ---------- Row A — System health ----------

    out.append(xy("lf-a1-llm-calls", "A1. LLM calls / hr (by category)",
        query=LLM_ALL,
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Calls"}],
        split={"field": "category", "size": 5, "label": "Category"},
        series_type="bar_stacked",
        description="Total LLM calls per hour, broken down by call category."))

    out.append(xy("lf-a2-tool-calls", "A2. Tool calls / hr",
        query=TOOL_SPAN,
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Tool calls"}],
        legend=False,
        description="Total tool execution span count per hour."))

    out.append(xy("lf-a3-p95-latency", "A3. Overall LLM p95 latency",
        query=LLM_ALL,
        metrics=[max_lat_p95()],
        legend=False,
        description=("Worst-hour p95 latency across all LLM calls. Uses max() over the "
                     "pre-aggregated hourly p95 buckets — surfaces tail spikes instead of "
                     "smoothing them. For 24h@1h interval this == the hour's actual p95.")))

    out.append(xy("lf-a7-ttft-p95", "A7. Overall TTFT p95 (streaming)",
        query=STREAM_AGENT,
        metrics=[max_ttft_p95()],
        legend=False,
        description="Worst-hour TTFT p95 across all streaming agents. Drives the perceived responsiveness of the chat UI."))

    out.append(xy("lf-a4-errors", "A4. Errors / hr (by category)",
        query="error_count > 0",
        metrics=[{"kind": "sum", "id": "m", "field": "error_count", "label": "Errors"}],
        split={"field": "category", "size": 6, "label": "Category"},
        series_type="bar_stacked",
        description="Error counts per hour stacked by category."))

    out.append(metric_panel("lf-a5-active-agents", "A5. Active agents",
        query=AGENT_LLM,
        metric={"kind": "cardinality", "id": "m", "field": "agent_name",
                "label": "Distinct agents"},
        description="Number of distinct agents that fired in the selected window."))

    out.append(metric_panel("lf-a8-active-models", "A8. Active LLM models",
        query=LLM_ALL,
        metric={"kind": "cardinality", "id": "m", "field": "model",
                "label": "Distinct models"},
        description="Number of distinct upstream LLM models invoked in the selected window."))

    out.append(xy("lf-a6-tokens", "A6. Tokens / hr (input vs output)",
        query=LLM_ALL,
        metrics=[
            {"kind": "sum", "id": "min", "field": "input_tokens", "label": "Input tokens"},
            {"kind": "sum", "id": "mout", "field": "output_tokens", "label": "Output tokens"},
        ],
        series_type="bar_stacked",
        description="Total tokens per hour for all LLM calls."))

    # ---------- Row B — Per-agent ops ----------

    out.append(xy("lf-b1-calls-by-agent", "B1. Calls by agent",
        query=AGENT_LLM,
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Calls"}],
        split={"field": "agent_name", "size": 8, "label": "Agent"},
        series_type="line",
        description="Calls per hour split by agent (top 8)."))

    out.append(xy("lf-b2-p95-by-agent", "B2. p95 latency by agent",
        query=AGENT_LLM,
        metrics=[max_lat_p95()],
        split={"field": "agent_name", "size": 8, "label": "Agent"},
        description="Worst-hour p95 latency per agent."))

    out.append(xy("lf-b3-ttft-by-agent", "B3. TTFT p95 by agent (streaming)",
        query=STREAM_AGENT,
        metrics=[max_ttft_p95()],
        split={"field": "agent_name", "size": 8, "label": "Agent"},
        description="Time-to-first-token p95 per streaming agent."))

    out.append(xy("lf-b4-error-rate-by-agent", "B4. Error rate by agent",
        query=AGENT_LLM,
        metrics=[w_error_rate()],
        split={"field": "agent_name", "size": 8, "label": "Agent"},
        description="sum(error_count)/sum(count) per agent over time."))

    out.append(xy("lf-b5-tps-by-agent", "B5. Output tokens/sec by agent",
        query=STREAM_AGENT,
        metrics=[w_out_tps()],
        split={"field": "agent_name", "size": 8, "label": "Agent"},
        description="Weighted output tokens per second; spots model-routing slowdowns."))

    out.append(horizontal_bar("lf-b6-tokens-by-agent", "B6. Tokens by agent (input + output)",
        query=AGENT_LLM,
        bucket={"field": "agent_name", "size": 12, "label": "Agent"},
        metric={"kind": "sum", "id": "m", "field": "total_tokens", "label": "Total tokens"},
        description="Total token usage by agent over the time picker window."))

    # ---------- Row C — Tool behavior ----------

    out.append(horizontal_bar("lf-c1-top-tools", "C1. Top 50 tools by call volume",
        query=TOOL_SPAN,
        bucket={"field": "tool_name", "size": 50, "label": "Tool"},
        metric={"kind": "sum", "id": "m", "field": "count", "label": "Calls"},
        description="Most frequently invoked tools in the time picker window."))

    out.append(heatmap("lf-c2-tool-latency-heat", "C2. Tool p95 latency heatmap",
        query=TOOL_SPAN,
        y_field="tool_name", y_size=50, y_label="Tool",
        metric=max_lat_p95(),
        y_order_alphabetical=True,
        description=("Tools (rows, sorted A→Z so prefix-related tools cluster) × "
                     "time (columns), colored by worst-hour p95 latency.")))

    out.append(datatable("lf-c3-tool-errors", "C3. Tools with errors (top 50)",
        query=f"({TOOL_SPAN}) and error_count > 0",
        bucket={"field": "tool_name", "size": 50, "label": "Tool"},
        order_by="errs",
        metrics=[
            {"kind": "sum", "id": "calls", "field": "count", "label": "Calls"},
            {"kind": "sum", "id": "errs", "field": "error_count", "label": "Errors"},
            w_error_rate(mid="rate"),
            {"kind": "max", "id": "p95", "field": "latency_p95_ms",
             "label": "p95 latency (worst hour)", "fmt": DUR_MS_FMT},
        ],
        description="Tools sorted by total errors, with error rate and worst-hour p95 latency for triage."))

    out.append(xy("lf-c4-tool-trend", "C4. Top 8 tool call trend",
        query=TOOL_SPAN,
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Calls"}],
        split={"field": "tool_name", "size": 8, "label": "Tool"},
        description="Call volume trend for the top 8 tools."))

    out.append(xy("lf-c5-handoff", "C5. Handoff volume",
        query="tool_name : handoff",
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Handoffs"}],
        legend=False,
        description="Agent-transition signals (handoff tool invocations)."))

    out.append(xy("lf-c6-rag-latency", "C6. RAG p95 latency",
        query='name : "Documentation Retrieval" or name : "KnowB Documentation Retrieval"',
        metrics=[max_lat_p95()],
        split={"field": "name", "size": 4, "label": "RAG source"},
        description="Documentation Retrieval p95 latency. RAG is on the critical path of every Develop turn."))

    out.append(heatmap("lf-c7-tool-errors-heat", "C7. Tool error rate heatmap",
        query=f"({TOOL_SPAN}) and count >= 5",
        y_field="tool_name", y_size=50, y_label="Tool",
        metric=w_error_rate(),
        y_order_alphabetical=True,
        palette=ERR_RATE_PALETTE,
        description=("Tools (rows, sorted A→Z) × time (columns), colored by error "
                     "rate (errors/calls). Green ≤0%, orange at 10%, red ≥30%. "
                     "Cells with <5 calls are dropped to suppress noise.")))

    # ---------- Row D — Model + background ----------

    model_query = "category : (agent_stream OR agent_oneshot OR tool_llm)"

    out.append(xy("lf-d1-calls-by-model", "D1. Calls by model",
        query=model_query,
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Calls"}],
        split={"field": "model", "size": 8, "label": "Model"},
        description="LLM call volume per model."))

    out.append(xy("lf-d2-p95-by-model", "D2. p95 latency by model",
        query=model_query,
        metrics=[max_lat_p95()],
        split={"field": "model", "size": 8, "label": "Model"},
        description="Worst-hour p95 latency per model."))

    out.append(xy("lf-d3-ttft-by-model", "D3. TTFT p95 by model",
        query=STREAM_AGENT,
        metrics=[max_ttft_p95()],
        split={"field": "model", "size": 6, "label": "Model"},
        description="Time-to-first-token p95 per model (streaming agents only)."))

    out.append(xy("lf-d4-errors-by-model", "D4. Error rate by model",
        query=model_query,
        metrics=[w_error_rate()],
        split={"field": "model", "size": 8, "label": "Model"},
        description="sum(error_count)/sum(count) split by model."))

    out.append(xy("lf-d5-feature-volume", "D5. Background feature LLM volume",
        query="category : (feature_llm OR tool_llm)",
        metrics=[{"kind": "sum", "id": "m", "field": "count", "label": "Calls"}],
        split={"field": "name", "size": 10, "label": "Feature"},
        description="Volume of non-agent LLM calls (summarization, assessment, tool-embedded LLMs)."))

    out.append(horizontal_bar("lf-d6-tokens-by-model", "D6. Total tokens by model",
        query=model_query,
        bucket={"field": "model", "size": 10, "label": "Model"},
        metric={"kind": "sum", "id": "m", "field": "total_tokens", "label": "Total tokens"},
        description="Cumulative token consumption per model in the selected window."))

    return out


# ---------------------------------------------------------------------------
# Markdown / text section headers
# ---------------------------------------------------------------------------

def markdown_panel(panel_id: str, title: str, markdown: str) -> dict[str, Any]:
    """Markdown header / explanation panel (legacy markdown visualization)."""
    return {
        "id": panel_id,
        "type": "visualization",
        "attributes": {
            "title": title,
            "visState": json.dumps({
                "title": title,
                "type": "markdown",
                "aggs": [],
                "params": {"fontSize": 12, "openLinksInNewTab": True, "markdown": markdown},
            }),
            "uiStateJSON": "{}",
            "description": "",
            "version": 1,
            "kibanaSavedObjectMeta": {
                "searchSourceJSON": json.dumps({
                    "query": {"query": "", "language": "kuery"}, "filter": [],
                }),
            },
        },
        "references": [],
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": "8.5.0",
    }


HEADER_INTRO = ("lf-md-intro", "About this dashboard", """
### Airo Agents — Operational Health

Hourly Langfuse trace metrics shipped to Elasticsearch every 5 minutes.
Use the **time picker** (top-right) for 24h / 7d / 30d windows.

**Categories:** `agent_stream` (streamText agents) · `agent_oneshot` (generateText agents) · `tool_llm` (LLM-powered tools) · `feature_llm` (background LLM features) · `tool_span` (tool execution spans) · `system_span` (invoke_agent + RAG)

**Stat conventions:** percentile fields use `max()` over hourly buckets — surfaces tail spikes (worst-hour view), aligned with SRE practice.
Linear stats (avg, error rate, throughput) use traffic-weighted averages.
""".strip())

HEADER_A = ("lf-md-a", "Row A — System health", """
**System health** (whole platform): LLM call & tool span throughput, overall p95 latency and TTFT, errors, total tokens, and cardinality of active agents/models.
""".strip())

HEADER_B = ("lf-md-b", "Row B — Per-agent operations", """
**Per-agent operations**: same throughput / latency / errors / tokens, but split by `agent_name` (top 8 by traffic). TTFT and TPS panels are scoped to streaming agents only.
""".strip())

HEADER_C = ("lf-md-c", "Row C — Tool behavior", """
**Tool behavior**: top tools by call volume, latency heatmap, error datatable (with worst-hour p95 for triage), per-tool trends, agent handoffs, and RAG (Documentation Retrieval) latency.
""".strip())

HEADER_D = ("lf-md-d", "Row D — Models & background features", """
**Models & background**: per-model breakdowns (calls, p95 latency, TTFT, error rate, tokens) plus volume of non-agent LLM features (summarization, assessment, tool-embedded LLMs).
""".strip())


# ---------------------------------------------------------------------------
# Dashboard layout (48-col grid; each panel chooses row & col)
# ---------------------------------------------------------------------------

# Kibana 8.x dashboards use a 48-column grid. All chart panels are W2 (half-width);
# markdown headers span full width with a small height.
W2 = 24
W_FULL = 48
H = 16    # standard chart height
HM = 4    # markdown header height
HSTAT = 10  # single big-number stats can be shorter
HXL = 22  # taller chart (heatmap, top-N bar)
HXXL = 32  # extra-tall (top-50 tools heatmap / bar / table)


def _build_layout() -> list[tuple[str, int, int, int, int]]:
    """Stack rows top-to-bottom, two charts per row, with markdown headers."""
    rows: list[tuple[str, int, int, int, int]] = []
    y = 0

    def add_header(pid: str, h: int = HM) -> None:
        nonlocal y
        rows.append((pid, 0, y, W_FULL, h))
        y += h

    def add_pair(left: str, right: str, h: int = H) -> None:
        nonlocal y
        rows.append((left, 0, y, W2, h))
        rows.append((right, W2, y, W2, h))
        y += h

    add_header("lf-md-intro", h=8)
    add_header("lf-md-a")
    add_pair("lf-a1-llm-calls",     "lf-a2-tool-calls")
    add_pair("lf-a3-p95-latency",   "lf-a7-ttft-p95")
    add_pair("lf-a4-errors",        "lf-a6-tokens")
    add_pair("lf-a5-active-agents", "lf-a8-active-models", h=HSTAT)

    add_header("lf-md-b")
    add_pair("lf-b1-calls-by-agent",      "lf-b2-p95-by-agent")
    add_pair("lf-b3-ttft-by-agent",       "lf-b4-error-rate-by-agent")
    add_pair("lf-b5-tps-by-agent",        "lf-b6-tokens-by-agent")

    add_header("lf-md-c")
    add_pair("lf-c1-top-tools",      "lf-c2-tool-latency-heat", h=HXXL)
    add_pair("lf-c3-tool-errors",    "lf-c7-tool-errors-heat",  h=HXXL)
    add_pair("lf-c4-tool-trend",     "lf-c5-handoff")
    rows.append(("lf-c6-rag-latency", 0, y, W_FULL, H))
    y += H

    add_header("lf-md-d")
    add_pair("lf-d1-calls-by-model", "lf-d2-p95-by-model")
    add_pair("lf-d3-ttft-by-model",  "lf-d4-errors-by-model")
    add_pair("lf-d5-feature-volume", "lf-d6-tokens-by-model")

    return rows


LAYOUT: list[tuple[str, int, int, int, int]] = _build_layout()


# Maps panel id → saved-object type. Anything not listed defaults to "lens".
PANEL_TYPES: dict[str, str] = {
    "lf-md-intro": "visualization",
    "lf-md-a":     "visualization",
    "lf-md-b":     "visualization",
    "lf-md-c":     "visualization",
    "lf-md-d":     "visualization",
}


def dashboard_object(panel_objs: list[dict[str, Any]]) -> dict[str, Any]:
    panels_json: list[dict[str, Any]] = []
    references: list[dict[str, Any]] = []
    panel_titles = {p["id"]: p["attributes"]["title"] for p in panel_objs}

    for i, (pid, x, y, w, h) in enumerate(LAYOUT, start=1):
        panel_index = f"p{i}"
        ref_name = f"panel_{panel_index}"
        ptype = PANEL_TYPES.get(pid, "lens")
        is_md = ptype == "visualization"
        panels_json.append({
            "version": PANEL_VERSION,
            "type": ptype,
            "gridData": {"x": x, "y": y, "w": w, "h": h, "i": panel_index},
            "panelIndex": panel_index,
            "embeddableConfig": {"enhancements": {}, "hidePanelTitles": is_md},
            "title": "" if is_md else panel_titles.get(pid, pid),
            "panelRefName": ref_name,
        })
        references.append({"name": ref_name, "type": ptype, "id": pid})

    return {
        "id": DASHBOARD_ID,
        "type": "dashboard",
        "attributes": {
            "title": "Airo Agents — Operational Health",
            "description": (
                "Operational view over Langfuse hourly metrics: LLM/tool throughput, latency, "
                "errors, tokens, model and tool breakdowns. Use the time picker to switch "
                "between 24h / 7d / 30d. All percentiles are worst-hour max over the "
                "pre-aggregated hourly buckets (max of stored p95 across hours, not a "
                "true cross-hour percentile)."
            ),
            "optionsJSON": json.dumps({
                "useMargins": True, "syncColors": True, "syncCursor": True,
                "syncTooltips": False, "hidePanelTitles": False,
            }),
            "panelsJSON": json.dumps(panels_json),
            "timeRestore": True,
            "timeFrom": "now-24h",
            "timeTo": "now",
            "refreshInterval": {"pause": True, "value": 60000},
            "kibanaSavedObjectMeta": {
                "searchSourceJSON": json.dumps({
                    "query": {"query": "", "language": "kuery"},
                    "filter": [],
                }),
            },
        },
        "references": references,
        "coreMigrationVersion": CORE_MIG,
        "typeMigrationVersion": DASH_MIG,
    }


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> None:
    objs: list[dict[str, Any]] = [data_view_object()]
    panel_objs = panels()
    md_objs = [
        markdown_panel(*HEADER_INTRO),
        markdown_panel(*HEADER_A),
        markdown_panel(*HEADER_B),
        markdown_panel(*HEADER_C),
        markdown_panel(*HEADER_D),
    ]
    objs.extend(panel_objs)
    objs.extend(md_objs)
    objs.append(dashboard_object(panel_objs + md_objs))

    out_path = Path(__file__).resolve().parent / "dashboard.ndjson"
    with out_path.open("w", encoding="utf-8") as f:
        for o in objs:
            f.write(json.dumps(o, separators=(",", ":")))
            f.write("\n")
        f.write(json.dumps({
            "exportedCount": len(objs),
            "missingRefCount": 0,
            "missingReferences": [],
            "excludedObjects": [],
            "excludedObjectsCount": 0,
        }) + "\n")
    print(f"Wrote {len(objs)} saved objects to {out_path}")


if __name__ == "__main__":
    main()
