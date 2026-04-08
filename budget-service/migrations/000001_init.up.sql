-- Full schema for fresh Postgres, golang-migrate version 1 (replaces former 001–010 chain).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.trg_budget_session_items_check_item_budget() RETURNS trigger
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
  ) THEN
    RAISE EXCEPTION 'budget_item % does not belong to session budget', NEW.budget_item_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_budget_items_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.credits_used IS DISTINCT FROM NEW.credits_used
     AND OLD.budget_id IS NOT DISTINCT FROM NEW.budget_id
     AND OLD.credits_total IS NOT DISTINCT FROM NEW.credits_total
     AND OLD.credit_spend_ratio IS NOT DISTINCT FROM NEW.credit_spend_ratio
     AND OLD.expire_at IS NOT DISTINCT FROM NEW.expire_at
     AND OLD.starts_at IS NOT DISTINCT FROM NEW.starts_at
     AND OLD.renew_interval IS NOT DISTINCT FROM NEW.renew_interval
     AND OLD.resets_at IS NOT DISTINCT FROM NEW.resets_at
  THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_budget_item_credit_ledger_bump_credits_used() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE public.budget_items
  SET credits_used = credits_used + NEW.credits_delta
  WHERE id = NEW.budget_item_id;
  RETURN NEW;
END;
$$;

CREATE TABLE public.products (
  product_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (product_key),
  CONSTRAINT products_product_key_check CHECK ((char_length(product_key) > 0) AND (char_length(product_key) <= 256))
);

CREATE TABLE public.budgets (
  id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  product_key text,
  CONSTRAINT budgets_pkey PRIMARY KEY (id),
  CONSTRAINT budgets_product_key_fkey FOREIGN KEY (product_key) REFERENCES public.products (product_key)
);

CREATE TABLE public.budget_items (
  id uuid NOT NULL,
  budget_id uuid NOT NULL,
  credits_total numeric(20, 6) NOT NULL,
  credits_used numeric(20, 6) NOT NULL DEFAULT 0,
  credit_spend_ratio numeric(20, 6) NOT NULL,
  expire_at timestamp with time zone,
  starts_at timestamp with time zone,
  renew_interval text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  resets_at timestamp with time zone,
  CONSTRAINT budget_items_pkey PRIMARY KEY (id),
  CONSTRAINT budget_items_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.budgets (id) ON DELETE CASCADE,
  CONSTRAINT budget_items_credit_spend_ratio_check CHECK (credit_spend_ratio > 0::numeric),
  CONSTRAINT budget_items_credits_total_check CHECK (credits_total >= 0::numeric),
  CONSTRAINT budget_items_credits_used_check CHECK (credits_used >= 0::numeric),
  CONSTRAINT budget_items_renew_interval_check CHECK (
    renew_interval IS NULL
    OR renew_interval = ANY (ARRAY['DAY'::text, 'WEEK'::text, 'MONTH'::text, 'YEAR'::text])
  )
);

CREATE TABLE public.budget_sessions (
  id uuid NOT NULL,
  budget_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  reconciled_at timestamp with time zone,
  metadata jsonb,
  CONSTRAINT budget_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT budget_sessions_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.budgets (id) ON DELETE CASCADE
);

CREATE SEQUENCE public.budget_session_items_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE TABLE public.budget_session_items (
  id bigint NOT NULL,
  session_id uuid NOT NULL,
  budget_item_id uuid,
  cost_usd numeric(20, 6) NOT NULL,
  credits_charged numeric(20, 6) NOT NULL,
  call_request_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_session_items_pkey PRIMARY KEY (id),
  CONSTRAINT budget_session_items_cost_usd_check CHECK (cost_usd >= 0::numeric),
  CONSTRAINT budget_session_items_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items (id) ON DELETE SET NULL,
  CONSTRAINT budget_session_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.budget_sessions (id) ON DELETE CASCADE
);

ALTER SEQUENCE public.budget_session_items_id_seq OWNED BY public.budget_session_items.id;

ALTER TABLE ONLY public.budget_session_items ALTER COLUMN id SET DEFAULT nextval('public.budget_session_items_id_seq'::regclass);

CREATE TABLE public.budget_session_reports (
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_session_reports_pkey PRIMARY KEY (id),
  CONSTRAINT budget_session_reports_session_id_key UNIQUE (session_id),
  CONSTRAINT budget_session_reports_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.budget_sessions (id) ON DELETE CASCADE
);

CREATE TABLE public.budget_session_report_items (
  id uuid NOT NULL,
  report_id uuid NOT NULL,
  budget_cost numeric(20, 6) NOT NULL,
  product_cost numeric(20, 6) NOT NULL,
  category text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_session_report_items_pkey PRIMARY KEY (id),
  CONSTRAINT budget_session_report_items_budget_cost_check CHECK (budget_cost >= 0::numeric),
  CONSTRAINT budget_session_report_items_product_cost_check CHECK (product_cost >= 0::numeric),
  CONSTRAINT budget_session_report_items_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.budget_session_reports (id) ON DELETE CASCADE
);

CREATE TABLE public.budget_item_credit_ledger (
  id uuid NOT NULL,
  budget_item_id uuid NOT NULL,
  entry_kind text NOT NULL,
  credits_delta numeric(20, 6) NOT NULL,
  report_item_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_item_credit_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT budget_item_credit_ledger_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items (id) ON DELETE CASCADE,
  CONSTRAINT budget_item_credit_ledger_report_item_id_fkey FOREIGN KEY (report_item_id) REFERENCES public.budget_session_report_items (id) ON DELETE SET NULL,
  CONSTRAINT budget_item_credit_ledger_entry_kind_check CHECK (
    entry_kind = ANY (ARRAY['session_spend'::text, 'periodic_reset'::text, 'reimbursement'::text])
  ),
  CONSTRAINT budget_item_credit_ledger_credits_delta_nonzero CHECK (credits_delta <> 0::numeric),
  CONSTRAINT budget_item_credit_ledger_delta_kind_check CHECK (
    (entry_kind = 'session_spend'::text AND credits_delta > 0::numeric)
    OR (entry_kind = 'periodic_reset'::text AND credits_delta < 0::numeric)
    OR (entry_kind = 'reimbursement'::text AND credits_delta < 0::numeric)
  )
);

COMMENT ON TABLE public.budget_item_credit_ledger IS 'Append-only; do not UPDATE or DELETE rows or budget_items.credits_used will diverge from SUM(credits_delta).';

CREATE TABLE public.budget_session_report_item_allocations (
  report_item_id uuid NOT NULL,
  budget_item_id uuid NOT NULL,
  credits_used numeric(20, 6) NOT NULL,
  CONSTRAINT budget_session_report_item_allocations_pkey PRIMARY KEY (report_item_id, budget_item_id),
  CONSTRAINT budget_session_report_item_allocations_credits_used_check CHECK (credits_used >= 0::numeric),
  CONSTRAINT budget_session_report_item_allocations_budget_item_id_fkey FOREIGN KEY (budget_item_id) REFERENCES public.budget_items (id) ON DELETE CASCADE,
  CONSTRAINT budget_session_report_item_allocations_report_item_id_fkey FOREIGN KEY (report_item_id) REFERENCES public.budget_session_report_items (id) ON DELETE CASCADE
);

CREATE TABLE public.webhooks (
  id uuid NOT NULL,
  event_type text NOT NULL,
  product_key text NOT NULL,
  url text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_pkey PRIMARY KEY (id),
  CONSTRAINT webhooks_url_check CHECK ((char_length(trim(both from url)) > 0) AND (char_length(url) <= 2048)),
  CONSTRAINT webhooks_product_key_fkey FOREIGN KEY (product_key) REFERENCES public.products (product_key) ON DELETE CASCADE
);

CREATE TABLE public.budget_item_history (
  history_id uuid DEFAULT gen_random_uuid() NOT NULL,
  budget_item_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  credits_total numeric(20, 6) NOT NULL,
  credits_used numeric(20, 6) NOT NULL,
  credit_spend_ratio numeric(20, 6) NOT NULL,
  expire_at timestamp with time zone,
  starts_at timestamp with time zone,
  renew_interval text,
  resets_at timestamp with time zone,
  item_created_at timestamp with time zone NOT NULL,
  item_updated_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budget_item_history_pkey PRIMARY KEY (history_id)
);

CREATE TABLE public.budgets_history (
  history_id uuid DEFAULT gen_random_uuid() NOT NULL,
  budget_id uuid NOT NULL,
  product_key text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT budgets_history_pkey PRIMARY KEY (history_id)
);

CREATE TABLE public.products_history (
  history_id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_key text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT products_history_pkey PRIMARY KEY (history_id)
);

CREATE TABLE public.webhooks_history (
  history_id uuid DEFAULT gen_random_uuid() NOT NULL,
  webhook_id uuid NOT NULL,
  event_type text NOT NULL,
  product_key text NOT NULL,
  url text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  removed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_history_pkey PRIMARY KEY (history_id)
);

CREATE INDEX idx_budget_item_credit_ledger_budget_item_id ON public.budget_item_credit_ledger USING btree (budget_item_id);
CREATE INDEX idx_budget_item_history_budget_item_id ON public.budget_item_history USING btree (budget_item_id);
CREATE INDEX idx_budget_items_budget_id ON public.budget_items USING btree (budget_id);
CREATE INDEX idx_budget_session_items_session_id ON public.budget_session_items USING btree (session_id);
CREATE INDEX idx_budget_session_report_item_allocations_budget_item ON public.budget_session_report_item_allocations USING btree (budget_item_id);
CREATE INDEX idx_budget_session_report_items_report_id ON public.budget_session_report_items USING btree (report_id);
CREATE INDEX idx_budget_session_reports_session_id ON public.budget_session_reports USING btree (session_id);
CREATE INDEX idx_budget_sessions_budget_id ON public.budget_sessions USING btree (budget_id);
CREATE INDEX idx_webhooks_history_product_key ON public.webhooks_history USING btree (product_key);
CREATE INDEX idx_webhooks_product_event ON public.webhooks USING btree (product_key, event_type);
CREATE INDEX idx_webhooks_product_key ON public.webhooks USING btree (product_key);

CREATE TRIGGER budget_items_set_updated_at BEFORE UPDATE ON public.budget_items FOR EACH ROW EXECUTE FUNCTION public.trg_budget_items_set_updated_at();

CREATE TRIGGER budget_item_credit_ledger_bump_credits_used AFTER INSERT ON public.budget_item_credit_ledger FOR EACH ROW EXECUTE FUNCTION public.trg_budget_item_credit_ledger_bump_credits_used();

CREATE TRIGGER budget_session_items_check_item_budget BEFORE INSERT OR UPDATE OF budget_item_id, session_id ON public.budget_session_items FOR EACH ROW EXECUTE FUNCTION public.trg_budget_session_items_check_item_budget();

CREATE TRIGGER budget_sessions_set_updated_at BEFORE UPDATE ON public.budget_sessions FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

CREATE TRIGGER budgets_set_updated_at BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();
