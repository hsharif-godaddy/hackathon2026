-- Reverse of 000003_reset_interval_compact.up.sql
-- Restores renew_interval column name and legacy enum-like values.

ALTER TABLE public.budget_items
  DROP CONSTRAINT IF EXISTS budget_items_reset_interval_check;

-- Convert compact format back to legacy format where possible.
UPDATE public.budget_items
SET reset_interval = CASE reset_interval
  WHEN '1d' THEN 'DAY'
  WHEN '1w' THEN 'WEEK'
  WHEN '1mo' THEN 'MONTH'
  WHEN '1y' THEN 'YEAR'
  ELSE reset_interval
END
WHERE reset_interval IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_items' AND column_name = 'reset_interval'
  ) THEN
    ALTER TABLE public.budget_items RENAME COLUMN reset_interval TO renew_interval;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_item_history' AND column_name = 'reset_interval'
  ) THEN
    ALTER TABLE public.budget_item_history RENAME COLUMN reset_interval TO renew_interval;
  END IF;
END;
$$;

-- Restore the trigger function to use renew_interval.
CREATE OR REPLACE FUNCTION public.trg_budget_items_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.credits_used IS DISTINCT FROM NEW.credits_used
     AND OLD.budget_id IS NOT DISTINCT FROM NEW.budget_id
     AND OLD.credits_total IS NOT DISTINCT FROM NEW.credits_total
     AND OLD.credit_spend_ratio IS NOT DISTINCT FROM NEW.credit_spend_ratio
     AND OLD.expire_at IS NOT DISTINCT FROM NEW.expire_at
     AND OLD.starts_at IS NOT DISTINCT FROM NEW.starts_at
     AND OLD.renew_interval IS NOT DISTINCT FROM NEW.renew_interval
     AND OLD.resets_at IS NOT DISTINCT FROM NEW.resets_at
  THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Restore legacy constraint (DAY|WEEK|MONTH|YEAR or null).
ALTER TABLE public.budget_items
  ADD CONSTRAINT budget_items_renew_interval_check
  CHECK (
    renew_interval IS NULL
    OR renew_interval IN ('DAY', 'WEEK', 'MONTH', 'YEAR')
  );
