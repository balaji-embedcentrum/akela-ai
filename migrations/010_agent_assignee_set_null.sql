-- Migration 010: Agents can be deleted even when assigned to hunt tasks.
--
-- Problem: DELETE /agents/{id} returned 500 because hunt_tasks.assignee_id
-- and hunt_subtasks.assignee_id had default FK constraints (no ON DELETE
-- action). Postgres rejected the delete to preserve referential integrity.
--
-- Fix: switch the constraints to ON DELETE SET NULL. Deleting an agent now
-- marks their tasks as "unassigned" (assignee_id → NULL) instead of
-- blocking the delete. Task history, titles, status, comments — all
-- preserved. Clean delete without losing project data.
--
-- Idempotent: uses DO blocks that check for constraint existence before
-- dropping, so running this migration twice is safe.

DO $$
DECLARE
    constraint_name text;
BEGIN
    -- hunt_tasks.assignee_id → agents.id
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'hunt_tasks'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'hunt_tasks'::regclass AND attname = 'assignee_id')
      ];
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE hunt_tasks DROP CONSTRAINT %I', constraint_name);
    END IF;
    ALTER TABLE hunt_tasks
        ADD CONSTRAINT hunt_tasks_assignee_id_fkey
        FOREIGN KEY (assignee_id) REFERENCES agents(id) ON DELETE SET NULL;
END $$;

DO $$
DECLARE
    constraint_name text;
BEGIN
    -- hunt_subtasks.assignee_id → agents.id
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'hunt_subtasks'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'hunt_subtasks'::regclass AND attname = 'assignee_id')
      ];
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE hunt_subtasks DROP CONSTRAINT %I', constraint_name);
    END IF;
    ALTER TABLE hunt_subtasks
        ADD CONSTRAINT hunt_subtasks_assignee_id_fkey
        FOREIGN KEY (assignee_id) REFERENCES agents(id) ON DELETE SET NULL;
END $$;
