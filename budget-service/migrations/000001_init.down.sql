-- Reverse of 000001_init.up.sql (drop children before parents, triggers before functions).

DROP TRIGGER IF EXISTS budget_items_set_updated_at ON public.budget_items;
DROP TRIGGER IF EXISTS budget_item_credit_ledger_bump_credits_used ON public.budget_item_credit_ledger;
DROP TRIGGER IF EXISTS budget_session_items_check_item_budget ON public.budget_session_items;
DROP TRIGGER IF EXISTS budget_sessions_set_updated_at ON public.budget_sessions;
DROP TRIGGER IF EXISTS budgets_set_updated_at ON public.budgets;
DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;

DROP TABLE IF EXISTS public.budget_session_report_item_allocations;
DROP TABLE IF EXISTS public.budget_item_credit_ledger;
DROP TABLE IF EXISTS public.budget_session_report_items;
DROP TABLE IF EXISTS public.budget_session_reports;
DROP TABLE IF EXISTS public.budget_session_items;
DROP TABLE IF EXISTS public.budget_sessions;
DROP TABLE IF EXISTS public.budget_items;
DROP TABLE IF EXISTS public.webhooks;
DROP TABLE IF EXISTS public.budgets;
DROP TABLE IF EXISTS public.budget_item_history;
DROP TABLE IF EXISTS public.budget_items_history;
DROP TABLE IF EXISTS public.budgets_history;
DROP TABLE IF EXISTS public.products_history;
DROP TABLE IF EXISTS public.webhooks_history;
DROP TABLE IF EXISTS public.products;

DROP FUNCTION IF EXISTS public.trg_budget_session_items_check_item_budget();
DROP FUNCTION IF EXISTS public.trg_budget_items_set_updated_at();
DROP FUNCTION IF EXISTS public.trg_budget_item_credit_ledger_bump_credits_used();
DROP FUNCTION IF EXISTS public.trg_set_updated_at();

DROP EXTENSION IF EXISTS pgcrypto;
