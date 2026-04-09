ALTER TABLE public.budgets ADD COLUMN deleted_at timestamp with time zone;
ALTER TABLE public.budget_items ADD COLUMN deleted_at timestamp with time zone;
ALTER TABLE public.products ADD COLUMN deleted_at timestamp with time zone;
ALTER TABLE public.webhooks ADD COLUMN deleted_at timestamp with time zone;

DROP TABLE IF EXISTS public.budgets_history;
DROP TABLE IF EXISTS public.products_history;
DROP TABLE IF EXISTS public.webhooks_history;

ALTER TABLE public.budget_item_history RENAME TO budget_items_history;
ALTER INDEX idx_budget_item_history_budget_item_id RENAME TO idx_budget_items_history_budget_item_id;

CREATE OR REPLACE FUNCTION public.trg_budget_session_items_check_item_budget() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.budget_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM budget_items bi
    JOIN budget_sessions bs ON bs.budget_id = bi.budget_id
    WHERE bi.id = NEW.budget_item_id
      AND bs.id = NEW.session_id
      AND bs.reconciled_at IS NULL
      AND bi.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'budget_item % does not belong to session budget', NEW.budget_item_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_due_budget_item_resets(target_budget_id uuid DEFAULT NULL, batch_size integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  row_item record;
  processed_count integer := 0;
  now_at timestamp with time zone := now();
  next_reset_at timestamp with time zone;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 THEN
    RAISE EXCEPTION 'batch_size must be >= 1';
  END IF;

  FOR row_item IN
    SELECT bi.id, bi.credits_used, bi.resets_at, bi.reset_interval
    FROM public.budget_items bi
    WHERE bi.resets_at IS NOT NULL
      AND bi.reset_interval IS NOT NULL
      AND bi.resets_at <= now_at
      AND bi.deleted_at IS NULL
      AND (target_budget_id IS NULL OR bi.budget_id = target_budget_id)
    ORDER BY bi.resets_at, bi.id
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    next_reset_at := public.advance_reset_to_future(row_item.resets_at, row_item.reset_interval, now_at);

    IF row_item.credits_used > 0 THEN
      INSERT INTO public.budget_item_credit_ledger (
        id,
        budget_item_id,
        entry_kind,
        credits_delta,
        report_item_id
      ) VALUES (
        gen_random_uuid(),
        row_item.id,
        'periodic_reset',
        row_item.credits_used * -1,
        NULL
      );
    END IF;

    UPDATE public.budget_items
    SET resets_at = next_reset_at
    WHERE id = row_item.id;

    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$$;
