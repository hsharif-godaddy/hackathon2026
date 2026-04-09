-- Reverse of 000004_periodic_resets.up.sql
-- Removes periodic reset processing infrastructure.

-- Unschedule the cron job if pg_cron is available.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(job.jobid)
    FROM cron.job job
    WHERE job.jobname = 'budget_service_periodic_resets';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.process_due_budget_item_resets(uuid, integer);
DROP FUNCTION IF EXISTS public.advance_reset_to_future(timestamp with time zone, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.next_reset_from_interval(timestamp with time zone, text);

DROP INDEX IF EXISTS public.idx_budget_items_due_resets;
