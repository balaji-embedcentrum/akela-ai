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

## Redis AUTH

Akela requires Redis with password authentication. The `redis/redis.conf` file
sets `requirepass`. Both `docker-compose.yml` and `docker-compose.prod.yml` wire
the `REDIS_PASSWORD` environment variable into the connection URL — set this to
match the value in `redis/redis.conf`.

The healthcheck in production compose uses `redis-cli -a ${REDIS_PASSWORD} ping`
to verify Redis is up and accepting connections.

## CORS_ORIGIN

Akela's API enforces `CORS_ORIGIN` strictly — it must be set to the exact origin
of your dashboard (e.g. `https://your-akela-domain.com`). Requests from any other
origin are blocked. This prevents cross-site request forgery on authenticated
sessions. Never deploy with `CORS_ORIGIN=*` in production.

## Production recommendations

1. Always deploy behind TLS. Traefik + Let's Encrypt is wired up in
   `docker-compose.prod.yml`; set `ACME_EMAIL` and `AKELA_DOMAIN` in `.env`.
2. Use strong, unique values for `POSTGRES_PASSWORD`, `SECRET_KEY`,
   `ADMIN_PASSWORD`, and `REDIS_PASSWORD`. Generate them with
   `openssl rand -hex 32`.
3. Lock the GitHub OAuth app to the exact `GITHUB_REDIRECT_URI` — no wildcards.
4. Set `CORS_ORIGIN` to your dashboard's exact origin — never `*` in production.
5. Back up `postgres_data` regularly.
6. Rotate any agent `AKELA_API_KEY` that has been exposed.
7. Update `redis/redis.conf` `requirepass` to match your `REDIS_PASSWORD` in
   production — the local-dev default is intentionally weak and must be changed.
