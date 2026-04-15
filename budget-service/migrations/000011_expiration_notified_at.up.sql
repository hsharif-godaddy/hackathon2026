-- Add expiration_notified_at to track which items have had expiration webhooks queued.
-- This eliminates the windowed query gap for expirations.

ALTER TABLE budget_items ADD COLUMN expiration_notified_at timestamp with time zone;

-- Backfill: mark already-expired items as notified to avoid a flood of stale webhooks
-- on first deploy. Only items expiring from this point forward will trigger delivery.
UPDATE budget_items
SET expiration_notified_at = now()
WHERE expires_at IS NOT NULL
  AND expires_at <= now()
  AND deleted_at IS NULL;

-- Index for efficient expiration detection: find expired items not yet notified
CREATE INDEX idx_budget_items_pending_expiration ON budget_items (expires_at)
    WHERE expires_at IS NOT NULL AND expiration_notified_at IS NULL AND deleted_at IS NULL;
