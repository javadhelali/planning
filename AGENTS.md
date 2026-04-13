# Project Rules for Agents

These rules keep architecture and behavior consistent across the codebase.

## Service-Specific Guidance

AI agents must also read the service-level guides before making changes:

- For frontend work, follow `frontend/AGENTS.md`.
- For backend work, follow `backend/AGENTS.md`.

If a task touches both areas, apply both guides along with this root file.

## Database Schema Reference

- Backend task data schema source of truth: `backend/databases/postgres.sql`.
- When implementing or updating backend task services/routes and related frontend task flows, align field names, status values, and data types with this schema.

## Database MCP Usage

- When you need to query project data from the database or make database changes for this project, use the Postgres MCP defined in `backend/MCP/Postgres.py`.
- The Postgres MCP exposes a `run_query(query: str)` tool.
- `run_query` can fetch data and execute general SQL commands, including DDL, DQL, and DML statements.
- Prefer this MCP for database inspection, data reads, schema updates, and other direct SQL operations related to this project.
