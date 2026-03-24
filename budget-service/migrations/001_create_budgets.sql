-- migrations/001_create_budgets.sql

-- Up migration
CREATE TYPE budget_type AS ENUM ('interval', 'burndown');
CREATE TYPE reset_interval AS ENUM ('daily', 'monthly');

CREATE TABLE budgets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id          VARCHAR(21) NOT NULL,
    type                     budget_type NOT NULL,
    label                    VARCHAR(255) NOT NULL,
    max_credits              BIGINT NOT NULL,
    current_value            BIGINT NOT NULL,
    conversion_factor        DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    expiration_or_reset_date TIMESTAMPTZ NOT NULL,
    reset_interval           reset_interval,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_max_credits CHECK (max_credits > 0),
    CONSTRAINT valid_conversion_factor CHECK (conversion_factor > 0)
);

CREATE INDEX idx_budgets_subscription ON budgets(subscription_id);
CREATE INDEX idx_budgets_sub_expiration ON budgets(subscription_id, expiration_or_reset_date);

-- Down migration (comment block for reference)
-- DROP INDEX idx_budgets_sub_expiration;
-- DROP INDEX idx_budgets_subscription;
-- DROP TABLE budgets;
-- DROP TYPE reset_interval;
-- DROP TYPE budget_type;
