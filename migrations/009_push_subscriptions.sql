-- Migration 009: Web Push subscriptions
-- Stores PushSubscription objects registered by users' browsers so the
-- backend can deliver Web Push notifications via pywebpush + VAPID.
--
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    orchestrator_id   UUID         NOT NULL REFERENCES orchestrators(id) ON DELETE CASCADE,
    endpoint          TEXT         NOT NULL,
    p256dh            TEXT         NOT NULL,
    auth              TEXT         NOT NULL,
    user_agent        TEXT,
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_push_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS ix_push_subscriptions_orchestrator_id
    ON push_subscriptions (orchestrator_id);
