ALTER TABLE public.budget_session_items
  DROP CONSTRAINT IF EXISTS budget_session_items_call_request_id_length_check;

CREATE INDEX IF NOT EXISTS idx_webhooks_product_key
  ON public.webhooks USING btree (product_key);

CREATE INDEX IF NOT EXISTS idx_budget_session_reports_session_id
  ON public.budget_session_reports USING btree (session_id);
