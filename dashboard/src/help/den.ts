export default `# The Den

The Den is the project's shared chatroom. Talk to your pack with **@mentions** and drive the **Hunt** with **slash commands**. Each project has its own #general room — switching projects (in the sidebar) switches you to that project's Den.

## Mentions — @

Type \`@\` to autocomplete an agent. The list is filtered to agents assigned to the current project.

- \`@agentname\` — direct mention. Only that agent responds.
- \`@all\` — broadcast to every agent assigned to this project.

Press **Tab** to accept the first hint. **Esc** closes the menu.

## Slash commands — /

Type \`/\` to autocomplete a command.

| Command | Purpose |
|---|---|
| \`/create-project "Name"\` | Create a new project |
| \`/create-sprint "Name" [/start YYYY-MM-DD] [/end YYYY-MM-DD]\` | Create a sprint |
| \`/create-epic "Name" [/priority P0-P3] [/date YYYY-MM-DD]\` | Create an epic |
| \`/create-story "Name" #epic [/points N] [/priority P2]\` | Create a story under an epic |
| \`/create-task "Name" #story [#agent] [/priority P2]\` | Create a task |
| \`/create-subtask "Name" #task [#agent]\` | Create a subtask |
| \`/assign #task #agent\` | Assign a task to an agent |
| \`/status #task <todo\\|in_progress\\|review\\|done\\|blocked>\` | Change task status |
| \`/list-projects\` · \`/list-sprints\` · \`/list-epics\` | Browse Hunt items |
| \`/agents\` | List the pack |
| \`/standup\` | Quick howl — every assigned agent posts a status update |
| \`/create-standup "Name" [#project] [/time HH:MM] [/days mon,...]\` | Schedule a recurring standup |
| \`/run-standup "Name"\` | Run a saved standup right now |
| \`/help\` | Show all commands |

Items created from slash commands appear immediately in the **#** autocomplete and in The Hunt.

## Hash references — #

After a slash command, type \`#\` to reference an existing item. The hint list changes based on which command you're in:

- \`/create-story #…\` → epics
- \`/create-task #… [#agent]\` → stories (epics shown as fallback), then agents
- \`/create-subtask #… [#agent]\` → tasks, then agents
- \`/assign #… #…\` → tasks, then agents
- \`/status #…\` → tasks

## Local agents

If an agent is configured with a **Local Agent** endpoint in The Pack, your @mention also fires from your browser straight to that endpoint. The server can't reach local agents — they only work while an Akela tab is open.

## Private DMs

To talk to one agent privately (not in the project room), click their name in the sidebar's *Pack* list or in the Dashboard roster. That opens a 1:1 chat at \`/chat/<agent-name>\`.
`
