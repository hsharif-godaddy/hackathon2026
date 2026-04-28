-- Schema hygiene:
-- 1. Drop redundant indexes (duplicates of UNIQUE constraint or prefix of composite index).
-- 2. Bound call_request_id length to prevent oversized values bloating the UNIQUE index.

-- idx_budget_session_reports_session_id is redundant with UNIQUE (session_id) constraint
-- which already provides a btree on session_id.
DROP INDEX IF EXISTS idx_budget_session_reports_session_id;

-- idx_webhooks_product_key is a strict prefix of idx_webhooks_product_event (product_key, event_type);
-- the composite index serves product_key-only lookups equally well.
DROP INDEX IF EXISTS idx_webhooks_product_key;

ALTER TABLE public.budget_session_items
  ADD CONSTRAINT budget_session_items_call_request_id_length_check
  CHECK (char_length(call_request_id) BETWEEN 1 AND 256);
