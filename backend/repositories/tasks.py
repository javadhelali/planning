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
created_at,
updated_at
"""


async def list_tasks(user_id: int, status: str | None = None) -> list[dict]:
    query = f"""
        select {TASK_COLUMNS}
        from tasks
        where user_id = $1
          and ($2::text is null or status = $2)
        order by created_at desc
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
) -> dict | None:
    query = f"""
        insert into tasks (user_id, title, notes, status, due_date, completed_at)
        values ($1, $2, $3, $4, $5, $6)
        returning {TASK_COLUMNS}
    """
    rows = await db.execute(query, user_id, title, notes, status, due_date, completed_at)
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
) -> dict | None:
    query = f"""
        update tasks
        set
            title = $3,
            notes = $4,
            status = $5,
            due_date = $6,
            completed_at = $7,
            updated_at = now()
        where id = $1
          and user_id = $2
        returning {TASK_COLUMNS}
    """
    rows = await db.execute(query, task_id, user_id, title, notes, status, due_date, completed_at)
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
