-- Add 'deduct' entry kind for generic credit deductions (non-USD, credit-denominated).

-- The DROP + re-ADD below is the only way to widen a CHECK constraint in Postgres
-- (no ALTER CONSTRAINT). It is atomic: golang-migrate runs each migration file in a
-- single transaction, so there is no window where the table is unconstrained. If the
-- team ever switches to a runner that does NOT wrap migrations in a transaction, split
-- this into add-new-then-drop-old or guard it explicitly.
ALTER TABLE public.budget_item_credit_ledger
  DROP CONSTRAINT budget_item_credit_ledger_entry_kind_check,
  DROP CONSTRAINT budget_item_credit_ledger_delta_kind_check;

ALTER TABLE public.budget_item_credit_ledger
  ADD CONSTRAINT budget_item_credit_ledger_entry_kind_check CHECK (
    entry_kind = ANY (ARRAY[
      'session_spend'::text, 'periodic_reset'::text, 'reimbursement'::text,
      'initial_spend'::text, 'upgrade'::text, 'downgrade'::text, 'deduct'::text
    ])
  ),
  ADD CONSTRAINT budget_item_credit_ledger_delta_kind_check CHECK (
    (entry_kind = 'session_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'periodic_reset'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'reimbursement'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'initial_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'upgrade'::text AND credits_delta <> 0::numeric)
    OR (entry_kind = 'downgrade'::text AND credits_delta <> 0::numeric)
    OR (entry_kind = 'deduct'::text AND credits_delta > 0::numeric)
  );

CREATE TABLE public.budget_deductions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  credits numeric(20, 6) NOT NULL,
  reason text,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_deductions_pkey PRIMARY KEY (id),
  CONSTRAINT budget_deductions_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.budgets (id),
  CONSTRAINT budget_deductions_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT budget_deductions_credits_positive CHECK (credits > 0::numeric),
  CONSTRAINT budget_deductions_idempotency_key_len CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  CONSTRAINT budget_deductions_reason_len CHECK (reason IS NULL OR char_length(reason) <= 256)
);

CREATE INDEX idx_budget_deductions_budget_id ON public.budget_deductions USING btree (budget_id);
