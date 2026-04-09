-- Revert cost_credit_ratio back to credit_spend_ratio
ALTER TABLE public.budget_items RENAME COLUMN cost_credit_ratio TO credit_spend_ratio;
ALTER TABLE public.budget_item_history RENAME COLUMN cost_credit_ratio TO credit_spend_ratio;

-- Revert constraint name
ALTER TABLE public.budget_items RENAME CONSTRAINT budget_items_cost_credit_ratio_check TO budget_items_credit_spend_ratio_check;

-- Revert expires_at back to expire_at
ALTER TABLE public.budget_items RENAME COLUMN expires_at TO expire_at;
ALTER TABLE public.budget_item_history RENAME COLUMN expires_at TO expire_at;

-- Restore trigger with original column names
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

ALTER TABLE public.budget_session_report_items RENAME COLUMN label TO category;
