-- Migration 005: Stories, Subtasks, and column additions for Hunt
-- Safe to run multiple times (idempotent).

DO $$
BEGIN

    -- ── hunt_stories ──────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hunt_stories') THEN
        CREATE TABLE hunt_stories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            epic_id UUID NOT NULL REFERENCES hunt_epics(id) ON DELETE CASCADE,
            sprint_id UUID REFERENCES hunt_sprints(id) ON DELETE SET NULL,
            title VARCHAR NOT NULL,
            description TEXT DEFAULT '',
            status VARCHAR DEFAULT 'todo',
            priority VARCHAR DEFAULT 'P2',
            story_points INTEGER,
            due_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
        RAISE NOTICE 'Created hunt_stories table';
    ELSE
        RAISE NOTICE 'hunt_stories already exists';
    END IF;

    -- ── hunt_subtasks ─────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hunt_subtasks') THEN
        CREATE TABLE hunt_subtasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id UUID NOT NULL REFERENCES hunt_tasks(id) ON DELETE CASCADE,
            assignee_id UUID REFERENCES agents(id) ON DELETE SET NULL,
            title VARCHAR NOT NULL,
            description TEXT DEFAULT '',
            status VARCHAR DEFAULT 'todo',
            due_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
        RAISE NOTICE 'Created hunt_subtasks table';
    ELSE
        RAISE NOTICE 'hunt_subtasks already exists';
    END IF;

    -- ── hunt_tasks: story_id ──────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_tasks' AND column_name = 'story_id'
    ) THEN
        ALTER TABLE hunt_tasks ADD COLUMN story_id UUID REFERENCES hunt_stories(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added story_id to hunt_tasks';
    END IF;

    -- ── hunt_tasks: due_date ──────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_tasks' AND column_name = 'due_date'
    ) THEN
        ALTER TABLE hunt_tasks ADD COLUMN due_date TIMESTAMP;
        RAISE NOTICE 'Added due_date to hunt_tasks';
    END IF;

    -- ── hunt_epics: due_date ──────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_epics' AND column_name = 'due_date'
    ) THEN
        ALTER TABLE hunt_epics ADD COLUMN due_date TIMESTAMP;
        RAISE NOTICE 'Added due_date to hunt_epics';
    END IF;

    -- ── hunt_sprints: start_date, end_date ────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_sprints' AND column_name = 'start_date'
    ) THEN
        ALTER TABLE hunt_sprints ADD COLUMN start_date TIMESTAMP;
        RAISE NOTICE 'Added start_date to hunt_sprints';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_sprints' AND column_name = 'end_date'
    ) THEN
        ALTER TABLE hunt_sprints ADD COLUMN end_date TIMESTAMP;
        RAISE NOTICE 'Added end_date to hunt_sprints';
    END IF;

END $$;
