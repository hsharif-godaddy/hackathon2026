-- Speed aggregates that filter on report line label (e.g. GET /api/v1/reports/aggregate?label=...).
CREATE INDEX IF NOT EXISTS idx_budget_session_report_items_label ON public.budget_session_report_items (label);
