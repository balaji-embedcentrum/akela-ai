-- Migration 004: Add orchestrator_id to messages for multi-user isolation
-- Safe to run multiple times (idempotent).
-- If only one orchestrator exists, backfills all existing messages to that orchestrator.

DO $$
DECLARE
    single_orch_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'orchestrator_id'
    ) THEN
        ALTER TABLE messages ADD COLUMN orchestrator_id UUID REFERENCES orchestrators(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added orchestrator_id column to messages';
    ELSE
        RAISE NOTICE 'orchestrator_id already exists on messages';
    END IF;

    -- Backfill NULL rows if there is exactly one orchestrator
    SELECT id INTO single_orch_id FROM orchestrators LIMIT 1 OFFSET 0;
    IF (SELECT COUNT(*) FROM orchestrators) = 1 AND single_orch_id IS NOT NULL THEN
        UPDATE messages SET orchestrator_id = single_orch_id WHERE orchestrator_id IS NULL;
        RAISE NOTICE 'Backfilled messages with orchestrator_id %', single_orch_id;
    END IF;
END $$;
