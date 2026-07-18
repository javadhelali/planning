# Prompt — make the `taroff` project agent-ready

> Run this with an AI coding agent (Claude Code or Codex) **on the `taroff` server, from inside
> `/app/code/taroff`** (the project root, where `docker-compose.yml` lives).

---

You are working on the **taroff** project. Your job is to bring this project's **agent
documentation** up to the standard used across our fleet, so any future agent (or human) can
understand it, run it, verify a change, deploy it, and debug it **without guessing** — and without
duplicating machine-wide facts that already live in `~/SERVER.md`.

**This is a documentation task only. Do not refactor or rewrite application code.** You will only
create/edit Markdown agent files (`AGENTS.md`, `CLAUDE.md`, and optionally per-service `AGENTS.md`).

## Ground rules

1. **Verify every fact against the live system before you write it.** Never invent a port, domain,
   service name, or command. Read real files and run read-only commands.
2. **Preserve the existing knowledge.** The current `/app/code/taroff/AGENTS.md` is a valuable
   Persian code-map (business logic in `application/sync/state_changes.py`, gateway services,
   endpoints, workers/schedules, admin & shop panel pages). **Keep all of it.** You are *adding* the
   missing operational sections, not deleting the domain knowledge.
3. **Write in the same language as the existing doc (Persian).** Keep the doc coherent in one
   language.
4. **Point *up* to `~/SERVER.md`; do not duplicate it.** Proxy/network, Docker build, CDN-TLS,
   deploy mechanics, and the domain list already live there — reference them, don't copy them.
5. **De-duplicate `CLAUDE.md`.** Right now `AGENTS.md` and `CLAUDE.md` are two identical full copies.
   Make `AGENTS.md` the single source of truth and reduce `CLAUDE.md` to a one-line pointer
   (`Read AGENTS.md for project rules and guidelines.`) or a symlink — match how the rest of the
   fleet does it.

## Context you already have (confirm it, don't trust it blindly)

- Server `taroff` (`185.173.104.92`, user `javadhelali`, Ubuntu 24.04). **This box is NOT
  internet-filtered** — `docker compose build` needs **no** `--build-arg HTTP_PROXY=…`. (Confirm in
  `~/SERVER.md`.)
- Project lives in `/app/code/taroff` (git repo + `docker-compose.yml`).
- Repo modules seen: `application/` (core business logic + FastAPI apps under
  `application/application/`), `core-api/` (DB layer — DB operations are meant to migrate here),
  `dashboard-admin/`, `dashboard-shop/`, `taroff-fastapi/`, `taroff-workers/`, `website/`, `nginx/`,
  `postgres/`, `redis/`, `scripts/`, `schema.sql`.
- Running compose services: `taroff_core_api`, `taroff_admin_api`, `taroff_admin_app`,
  `taroff_shop_api`, `taroff_shop_app`, `taroff_website`, `taroff_fastapi`, `taroff_workers`,
  `taroff_nginx`, `taroff_postgres`, `taroff_postgres_backup`, `taroff_redis` (plus `metabase`,
  `nginx-proxy-manager`, `portainer`).
- Domains (per `~/SERVER.md`): `api.taroff.ir`, `core-api.taroff.ir`, `admin.taroff.ir`,
  `admin-api.taroff.ir`, `admin.taroffcod.com`, `metabase.dev.taroff.ir`, `nginx.dev.taroff.ir`,
  `portainer.dev.taroff.ir`.
- Dev: pyenv envs `taroff`, `taroff-api`, `taroff-website`; no `run.sh` scripts; a service is run
  like `pyenv shell taroff && cd application && python -m main`.

## Step 1 — Read and discover (do this first)

- Read `~/SERVER.md` fully (it is the machine-wide source of truth).
- Read the existing `/app/code/taroff/AGENTS.md` and `CLAUDE.md`.
- Inspect the real system to confirm/complete the facts above:
  - `docker compose config` and `docker ps` → exact service names + internal/published ports.
  - `docker compose config` port mappings and `nginx/` config (or the `nginx-proxy-manager`
    routing) → **which domain maps to which service/port**.
  - `pyenv virtualenvs` → the env each sub-service uses.
  - For each runnable service (`application/`, `core-api/`, `taroff-fastapi`, `taroff-workers`,
    dashboards) determine the **exact command, working dir, pyenv env, and port**.
  - Find the DB connection details (compose env / config files) → how an agent reaches Postgres
    (host, port, db name) and Redis.

## Step 2 — Rewrite `/app/code/taroff/AGENTS.md`

Produce a single coherent doc with **both** the existing code-map **and** these added sections,
following the fleet structure:

1. **Title + one-line purpose** — what taroff is (the product) and who uses it.
2. **Repo / service map** — keep the existing module & endpoint & worker & panel-page content.
   Add, for each deployable piece, which compose service it becomes and which domain it serves.
3. **Database access** — how to query/inspect the DB (host/port/db, and the rule that DB operations
   go through `core-api/`). If a Postgres MCP is configured for this project, say to prefer it;
   otherwise give the concrete connection.
4. **Running this project**
   - A short pointer: *machine-wide conventions (proxy — none needed here — Docker build, CDN-TLS,
     deploy, domain list) live in `~/SERVER.md`; read it before anything that touches the network.*
   - **Development** — the exact per-service command + pyenv env + port (from Step 1).
   - **Verify** — read-only checks to run after a change so you don't stop at "it compiled":
     concrete `curl -s -o /dev/null -w '%{http_code}\n' …` calls against the real local ports and/or
     the public domains (expect 200), plus a DB sanity read for data-layer changes.
   - **Production** — the compose service list, the domain→service mapping, the deploy command
     (`docker compose build` with **no** proxy args on this box, then `docker compose up -d
     --remove-orphans`), and the CDN-TLS note (a direct HTTPS handshake to this box fails and that is
     expected — check origin over HTTP with a `Host` header; see `~/SERVER.md`).

Optionally, if it makes the doc cleaner, split service-specific detail into
`application/AGENTS.md`, `core-api/AGENTS.md`, `dashboard-admin/AGENTS.md`,
`dashboard-shop/AGENTS.md` and have the root `AGENTS.md` point to them.

## Step 3 — Fix `CLAUDE.md`

Replace the duplicate with a one-line pointer to `AGENTS.md` (or make it a symlink), matching the
fleet convention.

## Definition of done (self-check before you finish)

- [ ] A fresh agent, reading only `AGENTS.md` + `~/SERVER.md`, could: say what taroff is, run any
      service locally, **verify** a change, **deploy**, name the **production domain(s)**, and reach
      the **database** — with no guessing.
- [ ] All ports, domains, service names, and commands were confirmed against the live system.
- [ ] The existing Persian code-map is fully preserved.
- [ ] `AGENTS.md` points up to `~/SERVER.md` and does not duplicate proxy/deploy mechanics.
- [ ] `CLAUDE.md` is a one-line pointer/symlink, not a stale duplicate.

If you cannot verify a fact, write a clearly-marked `TODO:` line instead of guessing, and tell me
what you couldn't confirm.
