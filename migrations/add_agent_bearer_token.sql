-- Migration: add bearer_token to agents table
-- Run once on the production database.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bearer_token VARCHAR;
