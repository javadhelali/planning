from datetime import date, datetime

from databases.postgres import db


TASK_COLUMNS = """
id,
user_id,
title,
notes,
status,
due_date,
completed_at,
is_focused,
created_at,
updated_at
"""


async def list_tasks(user_id: int, status: str | None = None) -> list[dict]:
    query = f"""
        select {TASK_COLUMNS}
        from tasks
        where user_id = $1
          and ($2::text is null or status = $2)
        order by is_focused desc, created_at desc
    """
    rows = await db.execute(query, user_id, status)
    return rows or []


async def create_task(
    user_id: int,
    title: str,
    notes: str | None,
    status: str,
    due_date: date | None,
    completed_at: datetime | None,
    is_focused: bool,
) -> dict | None:
    query = f"""
        with lock_user as (
            select pg_advisory_xact_lock((9011::bigint * 4294967296) + ($1::bigint & 4294967295))
        ),
        reset_focus as (
            update tasks
            set is_focused = false,
                updated_at = now()
            where user_id = $1
              and is_focused = true
              and $7::boolean = true
              and exists (select 1 from lock_user)
            returning id
        ),
        inserted as (
            insert into tasks (user_id, title, notes, status, due_date, completed_at, is_focused)
            select $1, $2, $3, $4, $5, $6, $7
            from lock_user
            left join lateral (select 1 from reset_focus limit 1) rf on true
            returning {TASK_COLUMNS}
        )
        select * from inserted
    """
    rows = await db.execute(query, user_id, title, notes, status, due_date, completed_at, is_focused)
    if not rows:
        return None
    return rows[0]


async def update_task(
    task_id: int,
    user_id: int,
    title: str,
    notes: str | None,
    status: str,
    due_date: date | None,
    completed_at: datetime | None,
    is_focused: bool,
) -> dict | None:
    query = f"""
        with lock_user as (
            select pg_advisory_xact_lock((9011::bigint * 4294967296) + ($2::bigint & 4294967295))
        ),
        target as (
            select id
            from tasks
            where id = $1
              and user_id = $2
        ),
        reset_focus as (
            update tasks
            set is_focused = false,
                updated_at = now()
            where user_id = $2
              and is_focused = true
              and id <> $1
              and $8::boolean = true
              and exists (select 1 from target)
              and exists (select 1 from lock_user)
            returning id
        ),
        updated as (
            update tasks as t
            set
                title = $3,
                notes = $4,
                status = $5,
                due_date = $6,
                completed_at = $7,
                is_focused = $8,
                updated_at = now()
            from target
            left join lateral (select 1 from reset_focus limit 1) rf on true
            where t.id = target.id
            returning
                t.id,
                t.user_id,
                t.title,
                t.notes,
                t.status,
                t.due_date,
                t.completed_at,
                t.is_focused,
                t.created_at,
                t.updated_at
        )
        select * from updated
    """
    rows = await db.execute(query, task_id, user_id, title, notes, status, due_date, completed_at, is_focused)
    if not rows:
        return None
    return rows[0]


async def delete_task(task_id: int, user_id: int) -> bool:
    query = "delete from tasks where id = $1 and user_id = $2 returning id"
    deleted_rows = await db.execute(query, task_id, user_id)
    return bool(deleted_rows)


async def clear_completed_tasks(user_id: int) -> int:
    query = "delete from tasks where user_id = $1 and status = 'done' returning id"
    deleted_rows = await db.execute(query, user_id)
    return len(deleted_rows or [])
