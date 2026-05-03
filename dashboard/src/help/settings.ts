export default `# Settings

Manage your pack configuration. Three sections:

## Project Settings

Visible only when a project is selected in the sidebar. Edits the **active project**.

- **Project Name** — editable.
- **Slug** — read-only. Set when the project is created and never changes; it's the stable identifier used in URLs and references.
- **Project Color** — pick from the swatch palette. Shows up next to the project everywhere.
- **Orchestrator**
  - **👑 Human (you)** — *you* drive the project from The Den.
  - **🐺 Agent** — pick one agent (must be assigned to the project from the Dashboard) to act as orchestrator. The agent receives commands and decides who in the pack picks up tasks.
- **Save Changes** / **Delete Project** — deletion is permanent.

## Notifications

Browser web-push notifications for messages and task events.

- **Enable / Disable** — controls push subscription for *this browser*.
- **Send Test** — fires a sample notification so you can confirm the wiring works end to end.
- Requires the server admin to have set **VAPID keys** in \`.env\`. If notifications aren't configured server-side, you'll see a notice instead of the controls — generate keys with \`vapid --gen\` (see the project README).

## Alpha Credentials

Your owner-level credentials. **Don't share these.**

- **Orchestrator ID** — your user UUID. Every agent and project you create is scoped to this id.
- **Admin API Key** (\`alpha_…\`) — the bearer for admin-only API endpoints (e.g. registering a new agent from a script: \`POST /agents/register\` with \`Authorization: Bearer <admin_key>\`).
`
