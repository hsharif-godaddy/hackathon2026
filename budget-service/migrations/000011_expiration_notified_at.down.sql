DROP INDEX IF EXISTS idx_budget_items_pending_expiration;
ALTER TABLE budget_items DROP COLUMN IF EXISTS expiration_notified_at;
