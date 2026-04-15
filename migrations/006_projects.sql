-- Migration 006: Projects — top-level workstream scoping for Akela
-- Safe to run multiple times (idempotent).

DO $$
BEGIN

    -- ── projects ────────────────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
        CREATE TABLE projects (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id            UUID NOT NULL REFERENCES orchestrators(id) ON DELETE CASCADE,
            name                VARCHAR NOT NULL,
            description         TEXT DEFAULT '',
            color               VARCHAR DEFAULT '#4a9eff',
            orchestrator_type   VARCHAR DEFAULT 'human',   -- 'human' | 'agent'
            orchestrator_id     UUID,                      -- NULL = owner; agent.id if agent orchestrator
            sort_order          INTEGER DEFAULT 0,
            created_at          TIMESTAMP DEFAULT now()
        );
        RAISE NOTICE 'Created projects table';
    ELSE
        RAISE NOTICE 'projects table already exists';
    END IF;

    -- ── project_agents ──────────────────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_agents') THEN
        CREATE TABLE project_agents (
            project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            role        VARCHAR DEFAULT 'worker',          -- 'worker' | 'observer'
            added_at    TIMESTAMP DEFAULT now(),
            PRIMARY KEY (project_id, agent_id)
        );
        RAISE NOTICE 'Created project_agents table';
    ELSE
        RAISE NOTICE 'project_agents table already exists';
    END IF;

    -- ── agents.version ──────────────────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'version'
    ) THEN
        ALTER TABLE agents ADD COLUMN version VARCHAR;
        RAISE NOTICE 'Added version column to agents';
    ELSE
        RAISE NOTICE 'agents.version already exists';
    END IF;

    -- ── hunt_projects.project_id ────────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hunt_projects' AND column_name = 'project_id'
    ) THEN
        ALTER TABLE hunt_projects ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added project_id to hunt_projects';
    ELSE
        RAISE NOTICE 'hunt_projects.project_id already exists';
    END IF;

    -- ── conversations.project_id ────────────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'project_id'
    ) THEN
        ALTER TABLE conversations ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added project_id to conversations';
    ELSE
        RAISE NOTICE 'conversations.project_id already exists';
    END IF;

    -- ── standup_configs.project_id_fk ──────────────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'standup_configs' AND column_name = 'project_id_fk'
    ) THEN
        ALTER TABLE standup_configs ADD COLUMN project_id_fk UUID REFERENCES projects(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added project_id_fk to standup_configs';
    ELSE
        RAISE NOTICE 'standup_configs.project_id_fk already exists';
    END IF;

    -- ── standup_configs.response_window_minutes ─────────────────────────────
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'standup_configs' AND column_name = 'response_window_minutes'
    ) THEN
        ALTER TABLE standup_configs ADD COLUMN response_window_minutes INTEGER DEFAULT 30;
        RAISE NOTICE 'Added response_window_minutes to standup_configs';
    ELSE
        RAISE NOTICE 'standup_configs.response_window_minutes already exists';
    END IF;

END $$;
