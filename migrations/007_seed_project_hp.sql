-- Migration 007: Seed "Project HP" and migrate all existing data under it.
-- Safe to run multiple times (idempotent).

DO $$
DECLARE
    v_owner_id   UUID;
    v_project_id UUID;
BEGIN
    -- Only one orchestrator — get its ID
    SELECT id INTO v_owner_id FROM orchestrators LIMIT 1;
    IF v_owner_id IS NULL THEN
        RAISE NOTICE 'No orchestrator found — skipping seed';
        RETURN;
    END IF;

    -- Create Project HP if it doesn't exist
    SELECT id INTO v_project_id FROM projects WHERE owner_id = v_owner_id AND name = 'Project HP' LIMIT 1;
    IF v_project_id IS NULL THEN
        INSERT INTO projects (id, owner_id, name, description, color, orchestrator_type, sort_order)
        VALUES (gen_random_uuid(), v_owner_id, 'Project HP', 'Default project — migrated from pre-project Akela', '#4a9eff', 'human', 0)
        RETURNING id INTO v_project_id;
        RAISE NOTICE 'Created Project HP with id %', v_project_id;
    ELSE
        RAISE NOTICE 'Project HP already exists with id %', v_project_id;
    END IF;

    -- Assign all existing agents to Project HP (skip already assigned)
    INSERT INTO project_agents (project_id, agent_id, role)
    SELECT v_project_id, a.id, 'worker'
    FROM agents a
    WHERE a.orchestrator_id = v_owner_id
      AND NOT EXISTS (
          SELECT 1 FROM project_agents pa
          WHERE pa.project_id = v_project_id AND pa.agent_id = a.id
      );
    RAISE NOTICE 'Assigned agents to Project HP';

    -- Link all existing hunt_projects to Project HP (only unlinked ones)
    UPDATE hunt_projects
    SET project_id = v_project_id
    WHERE orchestrator_id = v_owner_id
      AND project_id IS NULL;
    RAISE NOTICE 'Linked hunt_projects to Project HP';

    -- Link all existing conversations to Project HP (only unlinked ones)
    UPDATE conversations
    SET project_id = v_project_id
    WHERE orchestrator_id = v_owner_id
      AND project_id IS NULL;
    RAISE NOTICE 'Linked conversations to Project HP';

    -- Link all existing standup_configs to Project HP (only unlinked ones)
    UPDATE standup_configs
    SET project_id_fk = v_project_id
    WHERE orchestrator_id = v_owner_id
      AND project_id_fk IS NULL;
    RAISE NOTICE 'Linked standup_configs to Project HP';

END $$;
