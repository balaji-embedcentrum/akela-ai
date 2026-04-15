-- Migration 008: Issue numbers (slug + shared counter per project)
-- Every sprint/epic/story/task/subtask gets a sequential issue_number
-- scoped to the Akela project. Display format: {SLUG}-{number} e.g. HP-1001

-- ── Akela projects: add slug + counter ───────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug VARCHAR(3);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS issue_counter INTEGER NOT NULL DEFAULT 1000;

-- Derive 3-char slug for existing projects from project name
DO $$
DECLARE
    proj   RECORD;
    base   TEXT;
    slug3  VARCHAR(3);
BEGIN
    FOR proj IN SELECT id, name FROM projects WHERE slug IS NULL LOOP
        -- Strip the word "project" (case-insensitive)
        base := REGEXP_REPLACE(proj.name, '(?i)\bproject\b', '', 'g');
        -- Strip non-alphanumeric chars and uppercase
        base := UPPER(REGEXP_REPLACE(base, '[^a-zA-Z0-9]', '', 'g'));
        -- Fallback: use full name if stripping left nothing
        IF base = '' THEN
            base := UPPER(REGEXP_REPLACE(proj.name, '[^a-zA-Z0-9]', '', 'g'));
        END IF;
        -- Pad to exactly 3 chars (repeat last char if short)
        IF LENGTH(base) = 0 THEN
            slug3 := 'PRJ';
        ELSIF LENGTH(base) = 1 THEN
            slug3 := base || base || base;
        ELSIF LENGTH(base) = 2 THEN
            slug3 := base || SUBSTRING(base, 2, 1);
        ELSE
            slug3 := SUBSTRING(base, 1, 3);
        END IF;
        UPDATE projects SET slug = slug3 WHERE id = proj.id;
    END LOOP;
END $$;

-- ── Add issue_number to all hunt tables ──────────────────────────────────────
ALTER TABLE hunt_sprints  ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE hunt_epics    ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE hunt_stories  ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE hunt_tasks    ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE hunt_subtasks ADD COLUMN IF NOT EXISTS issue_number INTEGER;
