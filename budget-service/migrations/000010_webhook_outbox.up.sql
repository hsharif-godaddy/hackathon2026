-- Webhook outbox table for transactional webhook delivery.
-- Events are written atomically with business operations, then drained for delivery.

CREATE TABLE public.webhook_outbox (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    product_key text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
    attempt_count integer NOT NULL DEFAULT 0,
    last_attempt_at timestamp with time zone,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    last_error text,
    idempotency_key text NOT NULL UNIQUE,    -- e.g., "reset:{itemId}:{resetsAt}"
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    processed_at timestamp with time zone,
    CONSTRAINT webhook_outbox_pkey PRIMARY KEY (id)
);

-- Index for efficient draining: find pending/processing events ready for delivery
CREATE INDEX idx_webhook_outbox_drain ON public.webhook_outbox (next_attempt_at)
    WHERE status IN ('pending', 'processing');
