from datetime import date, datetime
from decimal import Decimal

from databases.postgres import db


OKR_COLUMNS = """
o.id,
o.user_id,
o.title,
o.description,
o.start_date,
o.end_date,
o.is_archived,
o.archived_at,
o.created_at,
o.updated_at
"""

KEY_RESULT_COLUMNS = """
k.id as key_result_id,
k.title as key_result_title,
k.start_value as key_result_start_value,
k.current_value as key_result_current_value,
k.target_value as key_result_target_value,
k.step_value as key_result_step_value,
k.unit as key_result_unit,
k.created_at as key_result_created_at,
k.updated_at as key_result_updated_at
"""


def _to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _group_okrs(rows: list[dict] | None) -> list[dict]:
    grouped: dict[int, dict] = {}

    for row in rows or []:
        okr_id = row["id"]

        if okr_id not in grouped:
            grouped[okr_id] = {
                "id": okr_id,
                "user_id": row["user_id"],
                "title": row["title"],
                "description": row["description"],
                "start_date": row["start_date"],
                "end_date": row["end_date"],
                "is_archived": row["is_archived"],
                "archived_at": row["archived_at"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "key_results": [],
            }

        if row["key_result_id"] is None:
            continue

        grouped[okr_id]["key_results"].append(
            {
                "id": row["key_result_id"],
                "title": row["key_result_title"],
                "start_value": _to_float(row["key_result_start_value"]) or 0.0,
                "current_value": _to_float(row["key_result_current_value"]) or 0.0,
                "target_value": _to_float(row["key_result_target_value"]) or 0.0,
                "step_value": _to_float(row["key_result_step_value"]) or 1.0,
                "unit": row["key_result_unit"],
                "created_at": row["key_result_created_at"],
                "updated_at": row["key_result_updated_at"],
            }
        )

    return list(grouped.values())


async def list_okrs(user_id: int) -> list[dict]:
    query = f"""
        select
            {OKR_COLUMNS},
            {KEY_RESULT_COLUMNS}
        from okrs o
        left join okr_key_results k on k.okr_id = o.id
        where o.user_id = $1
        order by
            o.is_archived asc,
            case when o.is_archived then null else o.end_date end asc nulls last,
            o.archived_at desc nulls last,
            o.created_at desc,
            k.created_at asc
    """
    rows = await db.execute(query, user_id)
    return _group_okrs(rows)


async def get_okr(user_id: int, okr_id: int) -> dict | None:
    query = f"""
        select
            {OKR_COLUMNS},
            {KEY_RESULT_COLUMNS}
        from okrs o
        left join okr_key_results k on k.okr_id = o.id
        where o.user_id = $1
          and o.id = $2
        order by k.created_at asc
    """
    rows = await db.execute(query, user_id, okr_id)
    grouped = _group_okrs(rows)
    if not grouped:
        return None
    return grouped[0]


async def create_okr(
    user_id: int,
    title: str,
    description: str | None,
    start_date: date,
    end_date: date,
) -> dict | None:
    query = """
        insert into okrs (user_id, title, description, start_date, end_date, is_archived, archived_at)
        values ($1, $2, $3, $4, $5, false, null)
        returning id
    """
    rows = await db.execute(query, user_id, title, description, start_date, end_date)
    if not rows:
        return None
    return await get_okr(user_id, rows[0]["id"])


async def update_okr(
    okr_id: int,
    user_id: int,
    title: str,
    description: str | None,
    start_date: date,
    end_date: date,
) -> dict | None:
    query = """
        update okrs
        set
            title = $3,
            description = $4,
            start_date = $5,
            end_date = $6,
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, okr_id, user_id, title, description, start_date, end_date)
    if not rows:
        return None
    return await get_okr(user_id, okr_id)


async def archive_okr(okr_id: int, user_id: int) -> dict | None:
    query = """
        update okrs
        set
            is_archived = true,
            archived_at = now(),
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, okr_id, user_id)
    if not rows:
        return None
    return await get_okr(user_id, okr_id)


async def restore_okr(okr_id: int, user_id: int) -> dict | None:
    query = """
        update okrs
        set
            is_archived = false,
            archived_at = null,
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, okr_id, user_id)
    if not rows:
        return None
    return await get_okr(user_id, okr_id)


async def delete_okr(okr_id: int, user_id: int) -> bool:
    query = "delete from okrs where id = $1 and user_id = $2 returning id"
    rows = await db.execute(query, okr_id, user_id)
    return bool(rows)


async def create_key_result(
    okr_id: int,
    user_id: int,
    title: str,
    start_value: float,
    current_value: float,
    target_value: float,
    step_value: float,
    unit: str | None,
) -> dict | None:
    query = """
        insert into okr_key_results (
            okr_id,
            title,
            start_value,
            current_value,
            target_value,
            step_value,
            unit
        )
        select id, $3, $4, $5, $6, $7, $8
        from okrs
        where id = $1
          and user_id = $2
        returning okr_id
    """
    rows = await db.execute(
        query,
        okr_id,
        user_id,
        title,
        start_value,
        current_value,
        target_value,
        step_value,
        unit,
    )
    if not rows:
        return None
    return await get_okr(user_id, okr_id)


async def update_key_result(
    key_result_id: int,
    user_id: int,
    title: str,
    start_value: float,
    current_value: float,
    target_value: float,
    step_value: float,
    unit: str | None,
) -> dict | None:
    query = """
        with updated as (
            update okr_key_results k
            set
                title = $3,
                start_value = $4,
                current_value = $5,
                target_value = $6,
                step_value = $7,
                unit = $8,
                updated_at = now()
            from okrs o
            where k.id = $1
              and o.id = k.okr_id
              and o.user_id = $2
            returning k.okr_id
        )
        select okr_id from updated
    """
    rows = await db.execute(
        query,
        key_result_id,
        user_id,
        title,
        start_value,
        current_value,
        target_value,
        step_value,
        unit,
    )
    if not rows:
        return None
    return await get_okr(user_id, rows[0]["okr_id"])


async def adjust_key_result(key_result_id: int, user_id: int, delta: float) -> dict | None:
    query = """
        with updated as (
            update okr_key_results k
            set
                current_value = greatest(0, current_value + $3),
                updated_at = now()
            from okrs o
            where k.id = $1
              and o.id = k.okr_id
              and o.user_id = $2
            returning k.okr_id
        )
        select okr_id from updated
    """
    rows = await db.execute(query, key_result_id, user_id, delta)
    if not rows:
        return None
    return await get_okr(user_id, rows[0]["okr_id"])


async def delete_key_result(key_result_id: int, user_id: int) -> bool:
    query = """
        delete from okr_key_results k
        using okrs o
        where k.id = $1
          and o.id = k.okr_id
          and o.user_id = $2
        returning k.id
    """
    rows = await db.execute(query, key_result_id, user_id)
    return bool(rows)
