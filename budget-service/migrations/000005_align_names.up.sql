ALTER TABLE public.budget_session_report_items RENAME COLUMN category TO label;

-- Rename expire_at to expires_at for consistency with API expiresAt
ALTER TABLE public.budget_items RENAME COLUMN expire_at TO expires_at;
ALTER TABLE public.budget_item_history RENAME COLUMN expire_at TO expires_at;

-- Rename credit_spend_ratio to cost_credit_ratio for clarity and alignment with API costToCreditRatio
ALTER TABLE public.budget_items RENAME COLUMN credit_spend_ratio TO cost_credit_ratio;
ALTER TABLE public.budget_item_history RENAME COLUMN credit_spend_ratio TO cost_credit_ratio;

-- Rename constraint to match new column name
ALTER TABLE public.budget_items RENAME CONSTRAINT budget_items_credit_spend_ratio_check TO budget_items_cost_credit_ratio_check;

-- Update trigger function to reference new column names
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
  THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
