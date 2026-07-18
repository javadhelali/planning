# Prompt — document the `darolhadith` stack on the hadith server

> Run this with an AI coding agent (Claude Code or Codex) **on the `hadith` server, from
> `/pargar/code/darolhadith`**.

---

You are documenting the **darolhadith** stack. A previous attempt produced nothing because this
folder is **not a normal code project** — it is a **compose / deployment root**, and the actual
application code lives in **sibling repos** under `/pargar/code`. Your `AGENTS.md` must document the
*stack* and clearly point at where each service's code really is.

**Documentation task only. Do not refactor code.** Produce `AGENTS.md` (+ a thin `CLAUDE.md`) in
`/pargar/code/darolhadith`.

## What this stack is (confirm against `docker-compose.yml`)

`/pargar/code/darolhadith/docker-compose.yml` orchestrates the hadith data/API stack. Known from the
compose file (verify and complete):

- **`pargar_fastapi`** — builds from `docker/fastapi` (in this folder); mounts
  `/pargar/code/pargar-dashboard-build`. Determine what it actually serves and where its source is.
- **`hadith_api`** — **builds from context `/pargar/code/core`** → its code lives in the **`core`**
  sibling repo, *not* here.
- Data/infra services: **`pargar_postgres`**, **`pargar_clickhouse`**, **`pargar_redis`**,
  **`pargar_es00`** (Elasticsearch) + **`pargar_kibana`**, **`pargar_metabase`** — each builds from a
  `docker/<name>` subdir here.
- Machine-level facts already live in **`~/SERVER.md §6`** (this stack is listed there): domains
  `hadith-api.hadith.ir`, `encycl.riqh.ac.ir`; this box is **filtered** (proxy build-args needed);
  CDN terminates TLS.

## Step 1 — Discover

- Read `~/SERVER.md` (esp. §6) and this folder's `docker-compose.yml` in full.
- For **each** service: container name, build context (→ **which sibling repo / dir holds the
  code**), published/internal ports, env, volumes.
- Map **domain → service** (check the box's `nginx-proxy-manager` proxy-host configs): which of
  `hadith-api.hadith.ir` / `encycl.riqh.ac.ir` points to `hadith_api` vs `pargar_fastapi`.
- Data stores: for `pargar_postgres`, `pargar_clickhouse`, `pargar_redis`, `pargar_es00` — host
  (loopback?) + published port, in-cluster service name + internal port, db/index names. Confirm
  with `docker ps` and reading the compose env.
- **Local dev / debug:** look in the code repos (`/pargar/code/core`, and whatever `pargar_fastapi`
  builds from) for a `run.sh` or an obvious entrypoint (`main.py` / `api.main:app`), the pyenv env,
  and the port. Document exactly how to run each API **locally** for debugging. If a code repo has
  **no** `run.sh`, note it as a `TODO:` (and, if straightforward, add one following the
  `system-designer` / amin pattern: pin `PYENV_VERSION` + `pyenv exec` + port + `--reload`).

## Step 2 — Write `/pargar/code/darolhadith/AGENTS.md`

Follow the fleet structure, adapted for a compose-root:

1. **Title + one-line purpose** — what darolhadith is (the hadith data/API stack) and who consumes it.
2. **⚠️ Where the code lives** — state up front that this folder is the compose/deploy root and that
   application code is in sibling repos (`hadith_api` → `/pargar/code/core`, `pargar_fastapi` →
   whichever dir). An agent editing behavior must edit **there**, not here.
3. **Architecture** — service → code location → container → domain/port table.
4. **Database & data stores** — Postgres / ClickHouse / Redis / Elasticsearch (+ Kibana, Metabase):
   host+port (dev) and in-cluster name+port (prod), db/index names. Prefer a DB MCP if one is
   configured; otherwise give `docker exec … psql`/`curl` recipes (note `--noproxy '*'` for
   localhost if the shell is proxied).
5. **Running / debugging**
   - Pointer: *machine-wide conventions (proxy, Docker build-args for this filtered box, CDN-TLS,
     domains) live in `~/SERVER.md §6`; read it first.*
   - **Development** — how to run each API locally (the `run.sh`/entrypoint, pyenv env, port) from its
     code repo.
   - **Verify** — read-only post-change checks: `curl … --noproxy '*' localhost:<port>/…` (expect
     200), a DB/ES sanity read, and the **origin-over-HTTP `Host`-header** check for the public
     domains (a direct HTTPS handshake to this box fails by design; `502` is the real problem —
     see `~/SERVER.md §5`).
   - **Production** — compose services, domain→service map, deploy (`docker compose build` **with**
     the proxy build-args for this box, then `up -d --remove-orphans`; build only the changed
     service).
6. Thin `CLAUDE.md`: `Read AGENTS.md for project rules and guidelines.`

Write in **English**, matching `system-designer`'s doc on this box.

## Definition of done

- [ ] `AGENTS.md` exists in `/pargar/code/darolhadith` and makes clear this is a compose root whose
      code lives in sibling repos (each service mapped to its real code location).
- [ ] A fresh agent could: say what the stack is, find and run each API locally to debug, **verify** a
      change, **deploy** with the correct proxy build-args, name the **domain(s)**, and reach every
      **data store** — no guessing.
- [ ] Every service, port, domain, and code location was confirmed against the live system / compose
      file; unverifiable items are marked `TODO:`.
- [ ] Points up to `~/SERVER.md §6`; no duplication of proxy/deploy mechanics.

List anything you couldn't verify.
