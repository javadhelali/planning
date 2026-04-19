import json
from datetime import datetime
from typing import Literal

from databases.postgres import db


ActivityEventSource = Literal["manual", "tasks", "okrs", "glossary", "missions"]

ACTIVITY_EVENT_COLUMNS = """
id,
user_id,
source,
text,
metadata,
occurred_at,
created_at,
updated_at
"""


def _to_jsonb_param(metadata: dict | None) -> str:
    return json.dumps(metadata or {}, ensure_ascii=False, default=str)


def _parse_metadata(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except ValueError:
            return {}
    return {}


def _normalize_event_row(row: dict) -> dict:
    normalized = dict(row)
    normalized["metadata"] = _parse_metadata(row.get("metadata"))
    return normalized


async def ensure_activity_events_schema() -> None:
    await db.execute(
        """
        create table if not exists activity_events (
            id bigserial primary key,
            user_id bigint not null references users(id) on delete cascade,
            source text not null check (source in ('manual', 'tasks', 'okrs', 'glossary', 'missions')),
            text text not null check (char_length(trim(text)) > 0),
            metadata jsonb not null default '{}'::jsonb,
            occurred_at timestamptz not null default now(),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )
        """
    )
    await db.execute(
        """
        create index if not exists activity_events_user_time_idx
            on activity_events (user_id, occurred_at desc)
        """
    )
    await db.execute(
        """
        create index if not exists activity_events_user_source_time_idx
            on activity_events (user_id, source, occurred_at desc)
        """
    )
    await db.execute(
        """
        create index if not exists activity_events_metadata_gin_idx
            on activity_events using gin (metadata)
        """
    )


async def list_activity_events(
    user_id: int,
    source: ActivityEventSource | None = None,
    limit: int = 200,
) -> list[dict]:
    query = f"""
        select {ACTIVITY_EVENT_COLUMNS}
        from activity_events
        where user_id = $1
          and ($2::text is null or source = $2)
        order by occurred_at desc, id desc
        limit $3
    """
    rows = await db.execute(query, user_id, source, limit)
    return [_normalize_event_row(row) for row in rows or []]


async def create_activity_event(
    user_id: int,
    source: ActivityEventSource,
    text: str,
    metadata: dict | None = None,
    occurred_at: datetime | None = None,
) -> dict | None:
    query = f"""
        insert into activity_events (user_id, source, text, metadata, occurred_at)
        values (
            $1,
            $2,
            $3,
            coalesce($4::jsonb, '{{}}'::jsonb),
            coalesce($5, now())
        )
        returning {ACTIVITY_EVENT_COLUMNS}
    """
    rows = await db.execute(query, user_id, source, text, _to_jsonb_param(metadata), occurred_at)
    if not rows:
        return None
    return _normalize_event_row(rows[0])


async def get_activity_event(user_id: int, event_id: int) -> dict | None:
    query = f"""
        select {ACTIVITY_EVENT_COLUMNS}
        from activity_events
        where user_id = $1
          and id = $2
    """
    rows = await db.execute(query, user_id, event_id)
    if not rows:
        return None
    return _normalize_event_row(rows[0])


async def update_manual_activity_event(
    user_id: int,
    event_id: int,
    text: str,
    occurred_at: datetime,
) -> dict | None:
    query = f"""
        update activity_events
        set
            text = $3,
            occurred_at = $4,
            updated_at = now()
        where user_id = $1
          and id = $2
          and source = 'manual'
        returning {ACTIVITY_EVENT_COLUMNS}
    """
    rows = await db.execute(query, user_id, event_id, text, occurred_at)
    if not rows:
        return None
    return _normalize_event_row(rows[0])


async def delete_manual_activity_event(user_id: int, event_id: int) -> bool:
    query = """
        delete from activity_events
        where user_id = $1
          and id = $2
          and source = 'manual'
        returning id
    """
    rows = await db.execute(query, user_id, event_id)
    return bool(rows)


async def delete_activity_event(user_id: int, event_id: int) -> bool:
    query = """
        delete from activity_events
        where user_id = $1
          and id = $2
        returning id
    """
    rows = await db.execute(query, user_id, event_id)
    return bool(rows)
