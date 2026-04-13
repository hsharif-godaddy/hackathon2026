-- Remove 'initial_spend' entry kind.
-- WARNING: This will fail if any initial_spend ledger entries exist.

ALTER TABLE public.budget_item_credit_ledger
  DROP CONSTRAINT budget_item_credit_ledger_entry_kind_check,
  DROP CONSTRAINT budget_item_credit_ledger_delta_kind_check;

ALTER TABLE public.budget_item_credit_ledger
  ADD CONSTRAINT budget_item_credit_ledger_entry_kind_check CHECK (
    entry_kind = ANY (ARRAY['session_spend'::text, 'periodic_reset'::text, 'reimbursement'::text])
  ),
  ADD CONSTRAINT budget_item_credit_ledger_delta_kind_check CHECK (
    (entry_kind = 'session_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'periodic_reset'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'reimbursement'::text AND credits_delta < 0::numeric)
  );
