-- load-test/pg-monitor.sql — Run during load tests to monitor Postgres health.
-- Usage: watch -n 2 'psql "$DATABASE_URL" -f load-test/pg-monitor.sql'

\echo '=== Connection State ==='
SELECT state, wait_event_type, wait_event, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

\echo '=== Lock Waits (blocked queries) ==='
SELECT
  blocked.pid AS blocked_pid,
  blocked.query AS blocked_query,
  age(now(), blocked.query_start) AS waiting_for,
  blocker.pid AS blocker_pid,
  blocker.query AS blocker_query
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks gl ON gl.locktype = bl.locktype
  AND gl.database IS NOT DISTINCT FROM bl.database
  AND gl.relation IS NOT DISTINCT FROM bl.relation
  AND gl.page IS NOT DISTINCT FROM bl.page
  AND gl.tuple IS NOT DISTINCT FROM bl.tuple
  AND gl.pid != bl.pid
  AND gl.granted
JOIN pg_stat_activity blocker ON blocker.pid = gl.pid
WHERE blocked.datname = current_database()
LIMIT 10;

\echo '=== Table Row Counts ==='
SELECT 'budget_items' AS tbl, count(*) FROM budget_items
UNION ALL SELECT 'budget_sessions', count(*) FROM budget_sessions
UNION ALL SELECT 'budget_session_items', count(*) FROM budget_session_items
UNION ALL SELECT 'budget_item_credit_ledger', count(*) FROM budget_item_credit_ledger
UNION ALL SELECT 'budget_session_reports', count(*) FROM budget_session_reports
UNION ALL SELECT 'budget_session_report_items', count(*) FROM budget_session_report_items
UNION ALL SELECT 'webhook_outbox', count(*) FROM webhook_outbox
ORDER BY 1;

\echo '=== Active Transactions (>1s) ==='
SELECT pid, state, age(now(), xact_start) AS tx_age, left(query, 80) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND xact_start IS NOT NULL
  AND age(now(), xact_start) > interval '1 second'
ORDER BY tx_age DESC
LIMIT 10;

