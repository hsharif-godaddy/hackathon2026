-- NOTE: rollback-with-data hazard. Re-adding budget_item_credit_ledger_entry_kind_check
-- below excludes 'deduct'. If any 'deduct' ledger rows exist when this down migration
-- runs, the ADD CONSTRAINT will fail (existing rows violate it). Purge/convert any
-- 'deduct' rows before rolling back on a database that has taken live deductions.

DROP TABLE IF EXISTS public.budget_deductions;

ALTER TABLE public.budget_item_credit_ledger
  DROP CONSTRAINT budget_item_credit_ledger_entry_kind_check,
  DROP CONSTRAINT budget_item_credit_ledger_delta_kind_check;

ALTER TABLE public.budget_item_credit_ledger
  ADD CONSTRAINT budget_item_credit_ledger_entry_kind_check CHECK (
    entry_kind = ANY (ARRAY[
      'session_spend'::text, 'periodic_reset'::text, 'reimbursement'::text,
      'initial_spend'::text, 'upgrade'::text, 'downgrade'::text
    ])
  ),
  ADD CONSTRAINT budget_item_credit_ledger_delta_kind_check CHECK (
    (entry_kind = 'session_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'periodic_reset'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'reimbursement'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'initial_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'upgrade'::text AND credits_delta <> 0::numeric)
    OR (entry_kind = 'downgrade'::text AND credits_delta <> 0::numeric)
  );
