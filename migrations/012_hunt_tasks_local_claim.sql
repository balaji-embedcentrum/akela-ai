-- 012_hunt_tasks_local_claim.sql
-- Adds a claim lock for local-agent Hunt tasks so only one browser tab
-- executes a given task even when the user has several Akela tabs open.
--
-- Semantics:
--   * NULL         — nobody has claimed the task yet. The first
--                    POST /api/hunt/local/tasks/{id}/claim wins.
--   * non-NULL     — some tab already claimed it. Subsequent claims
--                    return 409.
--   * Cleared on /done so a new assignment (or /retry later) can start
--                    a fresh claim cycle.
--
-- Idempotent — safe to re-run.

BEGIN;

ALTER TABLE hunt_tasks
    ADD COLUMN IF NOT EXISTS local_claim_id TEXT NULL;

COMMIT;
