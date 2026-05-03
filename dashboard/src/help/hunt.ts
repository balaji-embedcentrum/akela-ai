export default `# The Hunt

The Hunt is the project task board. Work is organised as **Epic → Story → Task → Subtask**, optionally grouped into **Sprints**. Every project gets a Hunt automatically — visiting this page the first time creates one for the active project.

## Header controls

- **Sprint filter dropdown** — \`All Sprints\` or a specific sprint. Filters the items shown.
- **+ Sprint** — open the detail panel to create a new sprint with start/end dates.
- **List / Board** toggle — switch between the grouped list and a kanban board. Your choice is remembered (per browser).
- **Refresh** — manually reload epics, stories, sprints, and tasks. The page also auto-refreshes every 15 seconds and on agent task-status events.
- **+ Epic** — quick-add a new epic by title. Open it later to fill in details.

## List view

Items are grouped by epic. Stories sit under their epic; tasks sit under their story (or directly under the epic if no story). Click any item — epic, story, or task — to open the **detail panel** on the right where you can edit its title, priority, status, assignee, sprint, due date, and description.

## Board view

A kanban board with one column per status:

\`todo\` · \`in_progress\` · \`review\` · \`done\` · \`blocked\`

Tasks that change status while you're watching flash briefly so you can spot updates from agents.

## Tasks

Each task carries:
- **Status** — todo / in_progress / review / done / blocked
- **Priority** — P0 (highest) → P3 (lowest); defaults to P2
- **Assignee** — any agent assigned to the project
- **Sprint** — optional
- **Due date** — optional
- **Description** — supports multi-line text

When an agent is assigned to a task, Akela dispatches the work to them via their endpoint. The agent reports back via task-status updates, which appear here in real time.

## Empty states

- *No project selected* — pick or create a project in the sidebar.
- *No agents in this project* — go to **Dashboard** and assign agents to the project.
- *No epics yet* — click **+ Epic** to create your first one.

## Creating items from The Den

You don't have to use these buttons — anything here can also be created from The Den with slash commands:

- \`/create-epic "Name"\`
- \`/create-story "Name" #epic\`
- \`/create-task "Name" #story [#agent]\`
- \`/create-subtask "Name" #task [#agent]\`
- \`/assign #task #agent\` · \`/status #task <status>\`

Items appear here immediately.
`
