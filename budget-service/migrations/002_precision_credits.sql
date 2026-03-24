-- migrations/002_precision_credits.sql
-- Up migration: Convert credit columns from BIGINT to NUMERIC(20,6)

-- Change column types to support 6 decimal places
ALTER TABLE budgets
  ALTER COLUMN max_credits TYPE NUMERIC(20,6),
  ALTER COLUMN current_value TYPE NUMERIC(20,6);

-- Recreate constraint for decimal values
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS positive_max_credits;
ALTER TABLE budgets ADD CONSTRAINT positive_max_credits CHECK (max_credits > 0);

-- Down migration (comment block for reference)
-- ALTER TABLE budgets ALTER COLUMN max_credits TYPE BIGINT;
-- ALTER TABLE budgets ALTER COLUMN current_value TYPE BIGINT;
-- ALTER TABLE budgets DROP CONSTRAINT positive_max_credits;
-- ALTER TABLE budgets ADD CONSTRAINT positive_max_credits CHECK (max_credits > 0);
