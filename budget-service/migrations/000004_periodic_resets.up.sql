CREATE INDEX IF NOT EXISTS idx_budget_items_due_resets
  ON public.budget_items (resets_at, id)
  WHERE resets_at IS NOT NULL AND reset_interval IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_reset_from_interval(base_at timestamp with time zone, reset_interval text)
RETURNS timestamp with time zone
LANGUAGE plpgsql
AS $$
DECLARE
  value_text text;
BEGIN
  IF reset_interval IS NULL OR reset_interval !~ '^[1-9][0-9]*(d|w|mo|y)$' THEN
    RAISE EXCEPTION 'invalid reset_interval: %', reset_interval;
  END IF;

  value_text := substring(reset_interval from '^([1-9][0-9]*)');

  IF right(reset_interval, 2) = 'mo' THEN
    RETURN base_at + (value_text || ' months')::interval;
  END IF;

  IF right(reset_interval, 1) = 'd' THEN
    RETURN base_at + (value_text || ' days')::interval;
  ELSIF right(reset_interval, 1) = 'w' THEN
    RETURN base_at + ((value_text::numeric * 7)::text || ' days')::interval;
  ELSIF right(reset_interval, 1) = 'y' THEN
    RETURN base_at + (value_text || ' years')::interval;
  END IF;

  RAISE EXCEPTION 'invalid reset_interval: %', reset_interval;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_reset_to_future(reset_at timestamp with time zone, reset_interval text, now_at timestamp with time zone)
RETURNS timestamp with time zone
LANGUAGE plpgsql
AS $$
DECLARE
  next_at timestamp with time zone;
  value_text text;
  value_num numeric;
  days_per_period numeric;
  periods_to_advance bigint;
BEGIN
  next_at := reset_at;

  -- Fast-path for d/w intervals: compute periods arithmetically instead of looping.
  IF next_at <= now_at AND reset_interval ~ '^[1-9][0-9]*(d|w)$' THEN
    value_text := substring(reset_interval from '^([1-9][0-9]*)');
    value_num := value_text::numeric;

    IF right(reset_interval, 1) = 'd' THEN
      days_per_period := value_num;
    ELSE
      days_per_period := value_num * 7;
    END IF;

    -- Jump forward by computed number of periods.
    periods_to_advance := GREATEST(
      1::bigint,
      floor(EXTRACT(EPOCH FROM (now_at - next_at)) / (days_per_period * 86400))::bigint
    );
    next_at := next_at + ((periods_to_advance * days_per_period)::text || ' days')::interval;

    -- Ensure we land just past now_at (may need one more step due to floor).
    WHILE next_at <= now_at LOOP
      next_at := next_at + ((days_per_period)::text || ' days')::interval;
    END LOOP;

    RETURN next_at;
  END IF;

  -- mo/y intervals require calendar math (variable month lengths), loop is bounded.
  WHILE next_at <= now_at LOOP
    next_at := public.next_reset_from_interval(next_at, reset_interval);
  END LOOP;
  RETURN next_at;
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

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(job.jobid)
    FROM cron.job job
    WHERE job.jobname = 'budget_service_periodic_resets';

    PERFORM cron.schedule(
      'budget_service_periodic_resets',
      '* * * * *',
      'SELECT public.process_due_budget_item_resets(NULL, 500);'
    );
  END IF;
END;
$$;

