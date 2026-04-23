-- Support list ordering and productKey filter for GET /api/v1/reports
CREATE INDEX idx_budget_session_reports_created_id ON public.budget_session_reports USING btree (created_at, id);
CREATE INDEX idx_budgets_product_key ON public.budgets USING btree (product_key);