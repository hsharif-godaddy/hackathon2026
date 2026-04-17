ALTER TABLE public.budget_items ADD COLUMN label text;

ALTER TABLE public.budget_items_history ADD COLUMN label text;

CREATE OR REPLACE FUNCTION public.trg_budget_items_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.credits_used IS DISTINCT FROM NEW.credits_used
     AND OLD.budget_id IS NOT DISTINCT FROM NEW.budget_id
     AND OLD.credits_total IS NOT DISTINCT FROM NEW.credits_total
     AND OLD.cost_credit_ratio IS NOT DISTINCT FROM NEW.cost_credit_ratio
     AND OLD.expires_at IS NOT DISTINCT FROM NEW.expires_at
     AND OLD.starts_at IS NOT DISTINCT FROM NEW.starts_at
     AND OLD.reset_interval IS NOT DISTINCT FROM NEW.reset_interval
     AND OLD.resets_at IS NOT DISTINCT FROM NEW.resets_at
     AND OLD.label IS NOT DISTINCT FROM NEW.label
  THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
