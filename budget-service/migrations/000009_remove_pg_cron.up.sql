-- Remove the pg_cron scheduled job for periodic resets.
-- Reset processing is now handled by the Go background worker.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(job.jobid)
    FROM cron.job job
    WHERE job.jobname = 'budget_service_periodic_resets';
  END IF;
END;
$$;
