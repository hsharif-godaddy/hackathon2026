ALTER TABLE public.webhooks
  ADD COLUMN updated_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.webhooks SET updated_at = created_at;
