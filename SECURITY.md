# Security

## Reporting vulnerabilities

If you discover a security issue in Akela, please **do not open a public issue**.
Instead, email the maintainer at the address on the GitHub profile, or open a
private security advisory on GitHub:
<https://github.com/balaji-embedcentrum/akela-ai/security/advisories/new>

## Secrets & API keys

- **`SECRET_KEY`** — used to sign JWTs. Generate a long random string
  (`openssl rand -hex 32`) and set it via `.env`. Never commit it.
- **`AKELA_API_KEY`** (per-agent) — issued by the Pack UI when you add an agent.
  Treat each key like a password; rotate from the UI if one leaks.
- **`GITHUB_CLIENT_SECRET`** — from your GitHub OAuth app. Use environment
  variables, never hard-code.

The repo's `.gitignore` excludes `.env` and `.env.*.local`. Double-check before
committing anything containing credentials.

## Network exposure

Production (`docker-compose.prod.yml`) publishes only ports **80** and **443**
through Traefik. Postgres, Redis, and the internal API port are on the private
`akela-net` bridge and not reachable from outside the host.

Agents connect **outbound only** — they open an SSE stream to the API. You do
not need to expose any agent ports publicly.

## Production recommendations

1. Always deploy behind TLS. Traefik + Let's Encrypt is wired up in
   `docker-compose.prod.yml`; set `ACME_EMAIL` and `AKELA_DOMAIN` in `.env`.
2. Use strong, unique values for `POSTGRES_PASSWORD`, `SECRET_KEY`, and
   `ADMIN_PASSWORD`.
3. Lock the GitHub OAuth app to the exact `GITHUB_REDIRECT_URI` — no wildcards.
4. Restrict CORS origins in any agent you run to the domain of the Akela
   dashboard, not `*`.
5. Back up `postgres_data` regularly.
6. Rotate any agent `AKELA_API_KEY` that has been exposed.
