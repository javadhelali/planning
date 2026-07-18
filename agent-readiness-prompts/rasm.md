# Prompt — bootstrap agent docs for the `rasm` server + project

> Run this with an AI coding agent (Claude Code or Codex) **on the `rasm` server, from inside
> `~/code/pargar-system-rasm`** (the only project on this box).

---

You are on the **rasm** server. Unlike our other boxes, **this one has no agent documentation at
all** — there is no `~/SERVER.md`, no `~/.claude/CLAUDE.md`, no `~/.codex/AGENTS.md`, and the project
has no `AGENTS.md`. An agent landing here starts completely blind: it doesn't know the network/proxy
situation, the domain, the ports, or how to deploy. Your job is to **create both layers of
documentation from scratch**, matching the standard used across our fleet:

- **Machine layer:** `~/SERVER.md` (canonical machine-wide guide) + `~/.claude/CLAUDE.md` +
  `~/.codex/AGENTS.md` (thin files that import/point to `~/SERVER.md`).
- **Project layer:** `~/code/pargar-system-rasm/AGENTS.md` (+ a thin `CLAUDE.md`).

**This is a documentation task. Do not refactor application code.** You create Markdown files (and
verify runtime facts with read-only commands).

## Ground rules

1. **Discover, don't assume.** Every fact you write must come from inspecting this actual box. If you
   cannot verify something, write a clearly-marked `TODO:` line rather than guessing.
2. This box's filtering/proxy status is **unknown** — you must determine it (Step 1) before writing
   the network section. Do not copy another server's proxy story.

## Context you already have (confirm it, don't trust it blindly)

- Server `rasm` (`78.157.51.186`, port 22, user `javadhelali`, hostname `ubuntu`).
- The one project is `~/code/pargar-system-rasm`.
- Running docker containers seen: `fastapi` (`rasm_fastapi`), `workers` (`rasm_workers`),
  `admin-api` (`rasm_admin-api`), `admin-app` (`rasm_admin-app`), `nginx` (`rasm_nginx`),
  `rasm_redis`. (No Postgres container was visible — confirm whether the DB is a container, on the
  host, or external.)
- `pyenv` is installed; there is a `.claude` config dir but no agent docs.

## Step 1 — Discover the machine (network, Docker, filtering)

Run read-only checks and record the real answers:

- **Am I in a proxied shell already?** `echo "$http_proxy $https_proxy"`.
- **Is this box internet-filtered?** Compare direct vs proxied egress:
  - `curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://pypi.org/simple/` (direct)
  - if a proxy exists, the same through it: `curl -x http://127.0.0.1:44002 …`
  - Also test GitHub / Docker Hub reachability. Conclude: **filtered** (needs a proxy) or **not
    filtered** (like `taroff`).
- **Is there a proxy service?** `systemctl --user list-units 'sing-box*' 2>/dev/null`,
  `ss -ltnp | grep -E ':4400[12]|:449'`, and any `~/singbox-*.json`. Record ports and health.
- **Docker build reachability:** find the routable host IP for build containers —
  `ip -4 addr show docker0` (the bridge gateway) and the host's public IP `78.157.51.186`. Check
  `/etc/docker/daemon.json` for `registry-mirrors` (do pulls need a proxy or not?).
- **CDN/TLS:** determine how the public site is served (reverse proxy on the box? a CDN in front?).
  If TLS terminates at a CDN, a direct HTTPS handshake to the box will fail and that is expected —
  document how to actually check the origin.

## Step 2 — Discover the project + runtime

- `pwd`, `git remote -v`, read `docker-compose.yml`, `docker compose config`, `docker ps`.
- Exact service names + internal/published ports (`ss -ltnp`).
- **Domain(s):** from the `nginx` config, nginx-proxy-manager routing, or compose labels — map each
  domain to a service/port.
- **Dev entrypoints:** `run.sh` scripts or compose; the pyenv env(s) (`pyenv virtualenvs`) and exact
  command + working dir + port for each runnable service (`fastapi`, `workers`, `admin-api`,
  `admin-app`).
- **Data stores:** Redis (and Postgres/other) — container or external? host, port, db name, from
  compose env / project config.

## Step 3 — Write `~/SERVER.md` (machine-wide guide)

Model it on the fleet standard. Fill **every** value from Step 1–2 discovery. Sections:

1. **Header** — `# SERVER.md — network, proxy and Docker on the ` `rasm` ` server`, with host, user,
   OS. One-line "canonical machine-wide doc for this box; Claude loads it via `~/.claude/CLAUDE.md`,
   Codex via `~/.codex/AGENTS.md`."
2. **The short version** — is this box filtered? If yes: how egress works (proxy host/port), the
   three rules (per-command proxy on the host, Docker build needs a routable IP, pulls need no
   proxy). If **not** filtered: say so plainly (like `taroff`) and note builds need no proxy args.
3. **The proxy service** (only if one exists) — service name, SOCKS5/HTTP ports, config path, how to
   manage it (`systemctl --user …`, `journalctl --user -u …`).
4. **Docker** — build reachability (why `127.0.0.1` fails inside a build; the routable IP to use),
   registry mirrors / pulls, and runtime container egress.
5. **Using the proxy per command** (if filtered) — the pip / npm / curl / git / `docker compose
   build` recipes with **this box's** real IP. If not filtered, keep this minimal.
6. **Checking the live site** — the CDN-TLS reality for this box and the correct way to check the
   origin (HTTP + `Host` header if TLS is at a CDN).
7. **The project on this box** — `pargar-system-rasm`: its path, compose services, domain(s), dev
   entrypoints (commands, ports, pyenv envs), and data stores. This is the section a project agent
   leans on.

**Never persist a global proxy to an rc file** — if the box is filtered, state that the proxy is
per-command only, matching the rest of the fleet.

## Step 4 — Wire the CLI globals

- `~/.claude/CLAUDE.md` — a short "Global instructions" file that states the box's network reality in
  a few lines and **imports `~/SERVER.md`** (end it with a line `@~/SERVER.md`). Mention that code
  lives in `~/code/pargar-system-rasm`.
- `~/.codex/AGENTS.md` — the Codex equivalent: a short pointer telling Codex to read `~/SERVER.md`
  before touching the network, with the same key bullet points.

## Step 5 — Write the project `AGENTS.md` (in `~/code/pargar-system-rasm`)

Follow the fleet project structure:

1. **Title + one-line purpose** — what `pargar-system-rasm` is and who uses it.
2. **Architecture / repo layout** — the services (`fastapi`, `workers`, `admin-api`, `admin-app`)
   and what each does; the compose service name and domain for each.
3. **Database & data stores** — how to reach Redis (and any DB): host, port, db, access pattern.
4. **Running this project**
   - Pointer: *machine-wide conventions (network/proxy, Docker build, CDN-TLS, deploy, domain) live
     in `~/SERVER.md`; read it before anything that touches the network.*
   - **Development** — exact per-service command + pyenv env + port.
   - **Verify** — read-only post-change checks: concrete
     `curl -s -o /dev/null -w '%{http_code}\n' …` against real local ports and/or the public domain
     (expect 200), plus a data-store sanity read for data-layer changes.
   - **Production** — compose services, domain→service mapping, the deploy command (with the correct
     proxy build-args **only if** Step 1 found the box is filtered), and the CDN-TLS note if
     applicable.
5. A thin `CLAUDE.md`: `Read AGENTS.md for project rules and guidelines.` (or a symlink).

## Definition of done (self-check before you finish)

- [ ] `~/SERVER.md`, `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` all exist and agree on the box's
      real network/proxy status (which you *verified*, not assumed).
- [ ] The project `AGENTS.md` exists and points up to `~/SERVER.md`.
- [ ] A fresh agent, reading only these files, could: say what the project is, run each service
      locally, **verify** a change, **deploy**, name the **production domain(s)**, and reach the
      **data stores** — with no guessing.
- [ ] Every port, domain, service name, IP, and command was confirmed against the live system.
- [ ] No global proxy is persisted to any rc file.

List anything you could not verify (as `TODO:` lines and in your summary to me).
