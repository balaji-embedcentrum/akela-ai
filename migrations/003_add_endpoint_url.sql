-- Migration: Add endpoint_url column to agents table
-- Run this on the existing VPS database before deploying the new code.
-- This is idempotent — safe to run multiple times.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'endpoint_url'
    ) THEN
        ALTER TABLE agents ADD COLUMN endpoint_url VARCHAR DEFAULT '' NOT NULL;
        RAISE NOTICE 'Added endpoint_url column to agents table';
    ELSE
        RAISE NOTICE 'endpoint_url column already exists';
    END IF;
END $$;
