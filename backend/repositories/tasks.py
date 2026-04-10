from datetime import date, datetime

from databases.postgres import db


TASK_COLUMNS = """
id,
title,
notes,
status,
due_date,
completed_at,
created_at,
updated_at
"""


async def list_tasks(status: str | None = None) -> list[dict]:
    query = f"""
        select {TASK_COLUMNS}
        from tasks
        where ($1::text is null or status = $1)
        order by created_at desc
    """
    rows = await db.execute(query, status)
    return rows or []


async def create_task(
    title: str,
    notes: str | None,
    status: str,
    due_date: date | None,
    completed_at: datetime | None,
) -> dict | None:
    query = f"""
        insert into tasks (title, notes, status, due_date, completed_at)
        values ($1, $2, $3, $4, $5)
        returning {TASK_COLUMNS}
    """
    rows = await db.execute(query, title, notes, status, due_date, completed_at)
    if not rows:
        return None
    return rows[0]


async def update_task(
    task_id: int,
    title: str,
    notes: str | None,
    status: str,
    due_date: date | None,
    completed_at: datetime | None,
) -> dict | None:
    query = f"""
        update tasks
        set
            title = $2,
            notes = $3,
            status = $4,
            due_date = $5,
            completed_at = $6,
            updated_at = now()
        where id = $1
        returning {TASK_COLUMNS}
    """
    rows = await db.execute(query, task_id, title, notes, status, due_date, completed_at)
    if not rows:
        return None
    return rows[0]


async def delete_task(task_id: int) -> bool:
    query = "delete from tasks where id = $1 returning id"
    deleted_rows = await db.execute(query, task_id)
    return bool(deleted_rows)


async def clear_completed_tasks() -> int:
    query = "delete from tasks where status = 'done' returning id"
    deleted_rows = await db.execute(query)
    return len(deleted_rows or [])
