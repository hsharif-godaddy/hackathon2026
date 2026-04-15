-- Re-add the pg_cron job if rolling back to SQL-based periodic resets.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule(
      'budget_service_periodic_resets',
      '* * * * *',
      'SELECT public.process_due_budget_item_resets(NULL, 500);'
    );
  END IF;
END;
$$;
