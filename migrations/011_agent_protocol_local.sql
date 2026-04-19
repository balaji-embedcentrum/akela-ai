-- 011_agent_protocol_local.sql
-- Adds the new `local` value to AgentProtocol so Hunt tasks can be dispatched
-- to browser-resident local agents (URL lives in localStorage, never in the DB).
--
-- SAEnum(AgentProtocol, native_enum=False) in SQLAlchemy creates a VARCHAR
-- column with an implicit CHECK constraint. Postgres names the constraint
-- <table>_<column>_check by convention. We drop + re-create it so the new
-- value is accepted without rewriting any existing rows.

BEGIN;

-- Drop any existing check constraint on agents.protocol. The IF EXISTS
-- guard makes this idempotent across fresh + existing deployments.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT con.conname
      INTO constraint_name
      FROM pg_constraint con
      JOIN pg_class tbl ON con.conrelid = tbl.oid
     WHERE tbl.relname = 'agents'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%protocol%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE agents DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

-- Recreate the check constraint with the full enum set including `local`.
ALTER TABLE agents
    ADD CONSTRAINT agents_protocol_check
    CHECK (protocol IN ('openai', 'a2a', 'acp', 'adapter', 'local'));

COMMIT;
