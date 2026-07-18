# Prompt — make the `hadith` project agent-ready

> Run this with an AI coding agent (Claude Code or Codex) **on the `hadith` server, from inside the
> project's root folder** — e.g. `/pargar/code/darolhadith` (or `/pargar/code/system-designer`).
> Note: code on this box lives under **`/pargar/code`**, not `/app/code`. If more than one active
> project matters to you, run this prompt once inside each project's folder.

---

You are working on a project on the **hadith** server. This box already has **excellent
machine-level** agent docs (`~/SERVER.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) — but the
individual project repos under `/pargar/code` have **no `AGENTS.md` of their own**. Your job is to
add a project-level `AGENTS.md` (and a thin `CLAUDE.md`) to **the project you are currently in**, so
an agent working inside this repo has a local guide that points up to the machine doc and fills in
the repo-internal detail the machine doc doesn't carry.

**This is primarily a documentation task. Do not refactor application code** (see the optional
secondary task at the end). You create/edit Markdown agent files only.

## Ground rules

1. **Verify every fact against the live system before writing it.** Never invent a port, domain,
   service name, or command.
2. **`~/SERVER.md` is the source of truth for the machine.** It already documents this box's proxy
   (filtered — HTTP proxy `127.0.0.1:44002`, Docker build IP `185.142.159.90`), CDN-TLS, and a §6
   that lists this box's projects with their compose services, domains, `run.sh` ports and pyenv
   envs. **Read it first. Point up to it; do not duplicate it.**
3. Your project `AGENTS.md` adds what `~/SERVER.md §6` is too high-level to hold: the repo's internal
   architecture, the exact dev/run/verify steps, and how to reach the DB from inside this repo.

## Context you already have (confirm it, don't trust it blindly)

- Server `hadith` (`185.142.159.90`, user `hadith`, Ubuntu 22.04). **Filtered** — network access
  goes through the local `sing-box` proxy; Docker builds need
  `--build-arg HTTP_PROXY=http://185.142.159.90:44002 --build-arg HTTPS_PROXY=…` (see `~/SERVER.md`).
- Code root is `/pargar/code`. Active stacks:
  - **`darolhadith`** — compose services `pargar_fastapi`, `hadith_api`, `pargar_postgres`,
    `pargar_clickhouse`, `pargar_redis`, `pargar_kibana`, `pargar_metabase`. Domains:
    `hadith-api.hadith.ir`, `encycl.riqh.ac.ir`.
  - **`system-designer`** ("daneshnameh") — compose `daneshnameh-*` and `daneshnameh-agent-*`.
    Domains: `dn*.dev.hadith.ir`, `grafana.dev.hadith.ir`, `metabase.dev.hadith.ir`. Dev uses
    `run.sh` scripts calling pyenv by absolute path: `dashboard-api/run.sh` (:8201, env
    `system_designer_dashboard`), `agent/run-api.sh` (:8203, env `system_designer_agent`),
    `agent/run-workers.sh` (env `system_designer_agent`), `dashboard-app/run.sh` (:8200, node).
    `pyenv` is not on the non-interactive `PATH`; the scripts use absolute interpreter paths.
- **Known issue flagged in `~/SERVER.md`:** the `run.sh` scripts **hardcode Postgres passwords in
  plaintext**; they should move to gitignored `dev.env` / `prod.env` files (compose loads `prod.env`,
  run scripts load `dev.env`).

## Step 1 — Read and discover (do this first)

- Read `~/SERVER.md` fully, especially §6 for **this** project.
- Detect which project you are in (`pwd`, `git remote -v`, the `docker-compose.yml`).
- Confirm the real facts for this repo:
  - `docker compose config` + `docker ps` → exact service names and internal/published ports.
  - The domain→service mapping (nginx-proxy-manager routing, compose labels, or the box's reverse
    proxy config).
  - The dev entrypoints: `run.sh` scripts (their pyenv env, absolute interpreter path, port) or the
    compose services; confirm each port with `ss -ltnp`.
  - DB/services this repo talks to (Postgres, ClickHouse, Redis, Elasticsearch) — host, port, db —
    from compose env / config files.

## Step 2 — Create `AGENTS.md` in this project's root

Follow the fleet structure:

1. **Title + one-line purpose** — what this project is and who/what consumes it.
2. **Architecture / repo layout** — the services/components in this repo and what each does; for
   each, the compose service name and the domain it serves.
3. **Database & data stores** — how to reach each store this repo uses (Postgres/ClickHouse/Redis/
   Elasticsearch): host, port, db name, and any access pattern. Prefer a project DB MCP if one is
   configured; otherwise give the concrete connection.
4. **Running this project**
   - Pointer: *machine-wide conventions (proxy, Docker build args for this filtered box, CDN-TLS,
     domains) live in `~/SERVER.md §6`; read it before anything that touches the network.*
   - **Development** — exact commands: the `run.sh` (or compose) invocation per service, its port,
     its pyenv env. Note the pyenv-not-on-PATH / absolute-path detail where relevant.
   - **Verify** — read-only post-change checks: concrete
     `curl -s -o /dev/null -w '%{http_code}\n' …` against the real local ports and/or public domains
     (expect 200), plus a DB sanity read for data-layer changes.
   - **Production** — compose service list, domain→service mapping, the deploy command
     (`docker compose build` **with** the proxy build-args for this box, then `up -d
     --remove-orphans`), and the CDN-TLS note (direct HTTPS handshake to this box fails — expected;
     check origin over HTTP with a `Host` header; see `~/SERVER.md`).

## Step 3 — Add a thin `CLAUDE.md`

One line: `Read AGENTS.md for project rules and guidelines.` (or a symlink to `AGENTS.md`), matching
the fleet convention.

## Secondary task (optional — only if you also want to fix the flagged problem)

The `run.sh` scripts hardcode Postgres passwords in plaintext. If you choose to address it: move the
secrets into gitignored `dev.env` (loaded by the run scripts) and `prod.env` (loaded by compose),
replace the hardcoded values with env lookups, and confirm the services still start. **Do this only
as a clearly separate change, and confirm the .env files are gitignored.** If you skip it, at least
document the risk in `AGENTS.md`.

## Definition of done (self-check before you finish)

- [ ] A fresh agent, reading only this repo's `AGENTS.md` + `~/SERVER.md`, could: say what the
      project is, run each service locally, **verify** a change, **deploy** (with the correct proxy
      build-args), name the **production domain(s)**, and reach the **data stores** — no guessing.
- [ ] All ports, domains, service names, and commands were confirmed against the live system.
- [ ] `AGENTS.md` points up to `~/SERVER.md §6` and does not duplicate proxy/deploy mechanics.
- [ ] `CLAUDE.md` is a one-line pointer/symlink.

If you cannot verify a fact, write a clearly-marked `TODO:` line instead of guessing, and tell me
what you couldn't confirm.
