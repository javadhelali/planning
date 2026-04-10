# Backend


## `routes/`

**Purpose:** HTTP interface layer — defines endpoints, request/response schemas, and handles HTTP concerns.

- Each file maps to one resource or feature (e.g., `users.py`, `items.py`)
- **Each route file defines its own Pydantic schemas** (request/response models) at the top or in a dedicated section — no separate `schemas/` folder
- Panel route files must be placed directly under `panel_pages/`, and site service route files must be placed directly under `site_services/`
- Every new route file under `panel_pages/` or `site_services/` must be imported and added to the `routers` list in that folder's `__init__.py`
- Shared backend layers are top-level folders: `repositories/`, `core/`, `utilities/`, and `workers/`
- Routes validate input, call `core/`, `repositories/`, `external/`, or `utilities/`, and return a response
- Response shaping/serialization for HTTP output belongs in routes files
- Routes may access `databases/` directly only for rare, one-time queries that are tightly scoped to that route.
- Use dependency injection for auth, DB sessions, and shared logic

## `repositories/`

**Purpose:** Reusable data access layer for shared database reads and writes.

- One repository file per model/entity (e.g., `user.py`, `order.py`)
- Contains **only** query logic (CRUD operations, filters, joins, aggregations)
- Can only import from `databases/`, and in rare cases from `external/` or `utilities/`
- Returns model instances or plain data, never HTTP responses or Pydantic schemas
- Put queries here when they are expected to be reused by multiple routes/services/workers
- If a query is truly one-time and feature-local, it may stay in another valid layer (`routes/`, `core/`, or `workers/`) instead of creating a repository function
- Can be called by `routes/`, `core/`, `workers/`, or `external/` — never directly by other repositories

## `core/`

**Purpose:** Shared business logic and cross-cutting code used across the app.

- **Business logic lives here** — domain rules, orchestration, multi-step workflows
- Base classes and abstract interfaces
- App-wide constants and enums
- **Can call `repositories/`** to read/write data as part of business logic
- `core/` may run direct one-time queries against `databases/` only when the query is feature-local and unlikely to be reused
- `core/` must not be a pass-through/proxy layer; if a function only forwards a single repository call without added business rules, keep that call in the route/worker
- `core/` must not handle HTTP serialization/response formatting
- If logic is used by more than one route or worker, it belongs here

## `utilities/`

**Purpose:** Pure helper functions with no app-specific dependencies.

- Stateless, generic functions (string formatting, date helpers, hashing, pagination math)
- Must **not** import from `routes/`, `repositories/`, `databases/`, or `external/`
- Avoid making this a dumping ground — if a function is feature-specific, keep it near that feature

## `external/`

**Purpose:** All communication with third-party services and APIs.

- One file per integration (e.g., `stripe.py`, `sendgrid.py`, `s3.py`)
- Wraps SDK calls and HTTP clients behind clean, app-specific interfaces
- Handles retries, timeouts, and error translation (convert vendor errors → app exceptions)
- Never exposes raw SDK objects to the rest of the codebase — return plain dicts, dataclasses, or Pydantic models
- API keys and credentials come from config, never hardcoded

## `databases/`

**Purpose:** Database engine setup, connection management, and session lifecycle.

- DB engine and session factory configuration
- Connection pooling settings
- **No feature/business query functions in this layer** — keep `databases/` focused on connection/session setup

## `workers/`

**Purpose:** Background tasks, async jobs, and scheduled work.

- One file per job or task group (e.g., `email_sender.py`, `report_generator.py`)
- Celery tasks, APScheduler jobs, or any async queue consumers live here
- Workers call `core/`, `repositories/`, and `external/` — never `routes/`
- `workers/` may run direct one-time queries against `databases/` only for job-local logic that is unlikely to be reused
- Each task must be idempotent (safe to retry on failure)
- Keep task functions thin — orchestrate, don't implement. Complex logic belongs in `core/`
- Log extensively — workers run without HTTP context, so debugging relies on logs

## Dependency Rules (Import Direction)

```
routes/  →  core/  →  repositories/  →  databases/
  ↓          ↓             ↓
  ↓       external/     external/
  ↓          ↓
  ↓      databases/ (rare, one-time)
  ↓
  ↓      utilities/
  ↓
  ├→ repositories/ (direct)
  ├→ external/ (direct)
  ├→ utilities/ (direct)
  └→ databases/ (rare, one-time)

workers/ →  core/  →  repositories/  →  databases/
  ↓          ↓             ↓
  ↓       databases/ (rare, one-time)
  ├→ repositories/      external/
  ├→ external/
  ├→ databases/ (rare, one-time)
  └→ utilities/
```

| ✅ Allowed | ❌ Forbidden |
|-----------|-------------|
| `routes` → `core`, `repositories`, `external`, `utilities` | `repositories` → `routes` |
| `routes` → `databases` (rare, one-time queries only) | `utilities` → any app layer |
| `core` → `repositories`, `external`, `utilities` | `core` → `routes` |
| `core` → `databases` (rare, one-time queries only) | `workers` → `routes` |
| `workers` → `core`, `repositories`, `external`, `utilities` | `external` → `routes` |
| `workers` → `databases` (rare, one-time queries only) | `databases` → `routes`, `core`, `workers`, `repositories` |
| `repositories` → `databases`, `external`, `utilities` | `repositories` → `repositories` (direct cross-repo imports) |
| Any layer → `utilities` | Any layer → `routes` |
