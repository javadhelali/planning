# Project Rules for Agents

These rules keep architecture and behavior consistent across the codebase.

## Service-Specific Guidance

AI agents must also read the service-level guides before making changes:

- For frontend work, follow `frontend/AGENTS.md`.
- For backend work, follow `backend/AGENTS.md`.

If a task touches both areas, apply both guides along with this root file.

## Database MCP Usage

- When you need to query project data, read the database schema, or make database changes for this project, use the Postgres MCP.
- The Postgres MCP exposes two tools:
  - `run_fetch(query: str)` — run a query that returns rows (SELECT, or statements with RETURNING). Use it for all data reads and inspection.
  - `run_execute(query: str)` — run a statement that returns no rows (writes without RETURNING, plus DDL such as CREATE/ALTER). Use it for changes to data and schema.
- Prefer this MCP over hand-rolled `psql`/asyncpg scripts for any direct SQL against this project's database.

## Running This Project

Machine-wide conventions (deploy, proxy, CDN-TLS, ports, DB-MCP contract) live in
`/app/code/server/SERVER.md`. Read it before running anything that touches the network.

### Development

```bash
cd backend  && ./run.sh    # FastAPI on :8038  (pyenv env: planning)
cd frontend && ./run.sh    # Next.js  on :3038
```

- `run.sh` pins its own interpreter (`PYENV_VERSION=planning` + `pyenv exec`) and port, so you do
  **not** need to activate anything first.
- Python deps live in the **pyenv virtualenv `planning`**, not in a `.venv`. A stale `backend/.venv`
  directory exists and is unused — ignore it.
- Ports **8038 / 3038 are reserved for this project** across the whole server. Do not change them.
- Both services verified running: backend `/docs` → 200, frontend → 200.

### Verify

After a change, confirm the affected surface actually works — don't stop at "it compiled":

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8038/docs   # backend  → expect 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3038        # frontend → expect 200
```

- For data-layer changes, sanity-check through the Postgres MCP (`run_fetch`) rather than a separate
  DB client.

### Production

- Deployed with Docker Compose: `planning-backend`, `planning-frontend`, `planning-db`,
  `planning-db-backup`, `planning-redis`. All running.
- Domains: **questboard.ir** (frontend) and **api.questboard.ir** (backend). Both healthy.
- Deploy: standard build + `up` — see `/app/code/server/SERVER.md`.
- TLS terminates at the CDN, so a direct `https://questboard.ir` handshake against this box fails
  ("unrecognized name") — expected, not an outage. Check the origin over HTTP with a `Host` header
  instead. See `/app/code/server/SERVER.md`.
