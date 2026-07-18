# Prompt — taroff: add per-service `run.sh` debug scripts + translate the doc to English

> Run this with an AI coding agent (Claude Code or Codex) **on the `taroff` server, from
> `/app/code/taroff`**.

---

You are working on the **taroff** project. Two jobs, both to bring this project in line with the rest
of our fleet (the `amin` server), where **every service has a `run.sh` you can launch locally to
develop/debug it**, and where docs are in **English**.

**No Docker changes. We are NOT adding a separate debug/staging Docker tier** — debugging here means
*running each service locally with its own `run.sh`*, exactly like on `amin`.

---

## Part A — Give every service a `run.sh` (the fleet debug convention)

### The convention (copied from `amin`)

On `amin`, each service has a `run.sh` that **pins its own pyenv interpreter and its own port**, so
you can `cd` into any service and just `./run.sh` to run it locally with autoreload — no manual
`pyenv shell`, no venv activation. Reference (amin `planning/backend/run.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export ENV_FILE="${ENV_FILE:-dev.env}"          # only if the service reads an env file
export PYENV_VERSION="${PYENV_VERSION:-planning}"
exec pyenv exec python -m uvicorn api.main:app --host 0.0.0.0 --port 8038 --reload "$@"
```

Frontend reference (amin `planning/frontend/run.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://212.80.24.87:8038}"
exec npx next dev --port 3038
```

Key rules: `set -euo pipefail`; `cd "$(dirname "$0")"` so it runs from anywhere; **pin
`PYENV_VERSION`**; use `pyenv exec` (deps live in pyenv virtualenvs, **not** `.venv` — do not
reference `.venv`); `exec` the process; make it executable (`chmod +x`).

### What to create

Give **each runnable service its own `run.sh`** (workers get `run-workers.sh`). First **verify each
service's real entrypoint** by reading its code (the ASGI app path, e.g. `main:app` vs
`application.main:app`, or a `python main.py`); don't trust the table blindly. Target layout and a
**stable, non-colliding local port per service** (confirm nothing else uses them with `ss -ltnp`):

| Service dir | Script | Launch command (verify the app path) | pyenv env | Local port |
|---|---|---|---|---|
| `application/` (main API → `taroff_fastapi`) | `run.sh` | `pyenv exec python -m uvicorn application.main:app --host 0.0.0.0 --port 8000 --reload` | `taroff` | 8000 |
| `application/` (scheduler → `taroff_workers`) | `run-workers.sh` | `pyenv exec python -m workers` | `taroff` | — |
| `core-api/` (→ `taroff_core_api`) | `run.sh` | `pyenv exec python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload` | `taroff-api` | 8001 |
| `dashboard-admin/api/` (→ `taroff_admin_api`) | `run.sh` | `pyenv exec python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload` | `taroff-api` | 8002 |
| `dashboard-shop/api/` (→ `taroff_shop_api`) | `run.sh` | `pyenv exec python -m uvicorn main:app --host 0.0.0.0 --port 8003 --reload` | `taroff-api` | 8003 |
| `website/` (→ `taroff_website`) | `run.sh` | `pyenv exec python -m uvicorn main:app --host 0.0.0.0 --port 8004 --reload` | `taroff-website` | 8004 |
| `dashboard-admin/app/` (React CRA → `taroff_admin_app`) | `run.sh` | `exec npm start` (with `PORT=3001`) | node | 3001 |
| `dashboard-shop/app/` (React CRA → `taroff_shop_app`) | `run.sh` | `exec npm start` (with `PORT=3002`) | node | 3002 |

Notes:
- **Replace** the existing legacy `dashboard-shop/api/run.sh` (it has a commented-out `.venv` line
  and no pyenv pin) with the convention above.
- For the Python services, follow the amin template exactly; add `[ -f dev.env ] && export
  ENV_FILE="${ENV_FILE:-dev.env}"` **only if** the service actually loads an env file.
- For the React apps: `cd "$(dirname "$0")"`, `export PORT="${PORT:-3001}"` (CRA reads `PORT`), and
  if the app needs an API base URL at dev time, set the appropriate `REACT_APP_*`/`PUBLIC_URL` var —
  **check how each frontend resolves its backend** before hardcoding.
- `chmod +x` every script.
- Do a smoke test where feasible: launch a service via its `run.sh` and confirm it binds its port
  (`ss -ltnp | grep <port>`) and answers (`curl -s -o /dev/null -w '%{http_code}' localhost:<port>/`
  — or `/docs`). Then stop it. Report which ones you could/couldn't start.

### Then update `AGENTS.md`

Rewrite the **Development** section so each service is started with `cd <dir> && ./run.sh` (and
`run-workers.sh` for the scheduler), and record the **port map** above. Keep the "these ports are
local-dev only" note. The point: a future agent debugs by running `./run.sh` per service, just like
on `amin`.

---

## Part B — Translate `AGENTS.md` to English (keep Persian terms in parentheses)

Translate the **entire** `AGENTS.md` prose from Persian to **English**, so the fleet is consistent —
**but preserve the domain vocabulary** by putting the original Persian in parentheses on first/meaningful
use, so an agent still understands the project when someone refers to it in Persian.

Rules:
- **Keep all content and structure** — every section, table row, command, endpoint, worker, and
  panel-page entry. This is a translation, not a trim.
- Put the Persian original in parentheses for: the product name **Taroff (تعارف)**, core concepts
  (COD / cash-on-delivery (پرداخت در محل), gateway (گیت‌وی), preprint barcode (پیش‌پرینت), order
  states like `ready-to-send` (آماده ارسال), wallet/credit (کیف‌پول/اعتبار)), the **admin/shop panel
  page names** (translate the title, keep the Persian label in parens, keep the path unchanged), and
  any other domain term an operator would say in Persian.
- **Do not translate** code, identifiers, container names, domains, file paths, endpoint routes, or
  env/DB names — leave them verbatim.
- Keep the "point up to `~/SERVER.md`" note, the DB-access section, the Verify/Production sections,
  and the folder↔container↔domain table intact (translated).
- The title becomes e.g. `# taroff — Agent Guide (راهنمای پروژه تعارف)`.

`CLAUDE.md` is already the one-line English pointer — leave it.

---

## Definition of done

- [ ] Every service listed above has an executable `run.sh` (workers: `run-workers.sh`) that pins
      its pyenv env + port and runs with `--reload`, following the amin template; the legacy shop-api
      stub is replaced.
- [ ] You smoke-tested the scripts you could and reported the results (and any `TODO:` for ones you
      couldn't verify — e.g. missing pyenv env, unknown app path).
- [ ] `AGENTS.md` Development section drives everything through `./run.sh` with a documented port map.
- [ ] `AGENTS.md` is fully in English, with Persian domain terms preserved in parentheses; no content
      was dropped in translation.
- [ ] No new Docker services were added (local-run debugging only).

If you can't verify a fact (an app path, a pyenv env, a frontend's API var), write a clearly-marked
`TODO:` and tell me — don't guess.
