DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_items' AND column_name = 'renew_interval'
  ) THEN
    ALTER TABLE public.budget_items RENAME COLUMN renew_interval TO reset_interval;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'budget_item_history' AND column_name = 'renew_interval'
  ) THEN
    ALTER TABLE public.budget_item_history RENAME COLUMN renew_interval TO reset_interval;
  END IF;
END;
$$;

ALTER TABLE public.budget_items
  DROP CONSTRAINT IF EXISTS budget_items_renew_interval_check;

ALTER TABLE public.budget_items
  DROP CONSTRAINT IF EXISTS budget_items_reset_interval_check;

UPDATE public.budget_items
SET reset_interval = CASE upper(trim(reset_interval))
  WHEN 'DAY' THEN '1d'
  WHEN 'WEEK' THEN '1w'
  WHEN 'MONTH' THEN '1mo'
  WHEN 'YEAR' THEN '1y'
  ELSE lower(trim(reset_interval))
END
WHERE reset_interval IS NOT NULL;

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
     AND OLD.reset_interval IS NOT DISTINCT FROM NEW.reset_interval
     AND OLD.resets_at IS NOT DISTINCT FROM NEW.resets_at
  THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER TABLE public.budget_items
  ADD CONSTRAINT budget_items_reset_interval_check
  CHECK (
    reset_interval IS NULL
    OR reset_interval ~ '^[1-9][0-9]*(d|w|mo|y)$'
  );




