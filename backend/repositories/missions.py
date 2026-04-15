from databases.postgres import db


MISSION_COLUMNS = """
m.id,
m.user_id,
m.title,
m.description,
m.position,
m.created_at,
m.updated_at
"""

STEP_COLUMNS = """
s.id as step_id,
s.title as step_title,
s.description as step_description,
s.is_next as step_is_next,
s.position as step_position,
s.created_at as step_created_at,
s.updated_at as step_updated_at
"""


async def _get_mission(user_id: int, mission_id: int) -> dict | None:
    query = f"""
        select
            {MISSION_COLUMNS},
            {STEP_COLUMNS}
        from missions m
        left join mission_steps s on s.mission_id = m.id
        where m.user_id = $1
          and m.id = $2
        order by s.position asc, s.created_at asc
    """
    rows = await db.execute(query, user_id, mission_id)
    grouped = _group_missions(rows)
    if not grouped:
        return None
    return grouped[0]


def _group_missions(rows: list[dict] | None) -> list[dict]:
    grouped: dict[int, dict] = {}

    for row in rows or []:
        mission_id = row["id"]

        if mission_id not in grouped:
            grouped[mission_id] = {
                "id": mission_id,
                "user_id": row["user_id"],
                "title": row["title"],
                "description": row["description"],
                "position": row["position"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "steps": [],
            }

        if row["step_id"] is None:
            continue

        grouped[mission_id]["steps"].append(
            {
                "id": row["step_id"],
                "title": row["step_title"],
                "description": row["step_description"],
                "is_next": row["step_is_next"],
                "position": row["step_position"],
                "created_at": row["step_created_at"],
                "updated_at": row["step_updated_at"],
            }
        )

    return list(grouped.values())


async def list_missions(user_id: int) -> list[dict]:
    query = f"""
        select
            {MISSION_COLUMNS},
            {STEP_COLUMNS}
        from missions m
        left join mission_steps s on s.mission_id = m.id
        where m.user_id = $1
        order by m.position asc, m.created_at asc, s.position asc, s.created_at asc
    """
    rows = await db.execute(query, user_id)
    return _group_missions(rows)


async def create_mission(
    user_id: int,
    title: str,
    description: str | None,
) -> dict | None:
    query = """
        with next_pos as (
            select coalesce(max(position), 0) + 1 as position
            from missions
            where user_id = $1
        ),
        inserted as (
            insert into missions (user_id, title, description, position)
            select $1, $2, $3, next_pos.position
            from next_pos
            returning id
        )
        select id from inserted
    """
    rows = await db.execute(query, user_id, title, description)
    if not rows:
        return None
    return await _get_mission(user_id, rows[0]["id"])


async def update_mission(
    mission_id: int,
    user_id: int,
    title: str,
    description: str | None,
    position: int,
) -> dict | None:
    query = """
        update missions
        set
            title = $3,
            description = $4,
            position = greatest(1, $5),
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, mission_id, user_id, title, description, position)
    if not rows:
        return None
    return await _get_mission(user_id, mission_id)


async def delete_mission(mission_id: int, user_id: int) -> bool:
    query = "delete from missions where id = $1 and user_id = $2 returning id"
    rows = await db.execute(query, mission_id, user_id)
    return bool(rows)


async def create_mission_step(
    mission_id: int,
    user_id: int,
    title: str,
    description: str | None,
    is_next: bool,
) -> dict | None:
    query = """
        with target_mission as (
            select id
            from missions
            where id = $1
              and user_id = $2
        ),
        lock_mission as (
            select pg_advisory_xact_lock((9032::bigint * 4294967296) + ($1::bigint & 4294967295))
            from target_mission
        ),
        reset_next as (
            update mission_steps
            set is_next = false,
                updated_at = now()
            where mission_id = $1
              and is_next = true
              and $5::boolean = true
              and exists (select 1 from lock_mission)
            returning id
        ),
        next_pos as (
            select coalesce(max(position), 0) + 1 as position
            from mission_steps
            where mission_id = $1
        ),
        inserted as (
            insert into mission_steps (mission_id, title, description, is_next, position)
            select $1, $3, $4, $5, next_pos.position
            from target_mission
            cross join next_pos
            left join lateral (select 1 from reset_next limit 1) rn on true
            returning mission_id
        )
        select mission_id from inserted
    """
    rows = await db.execute(query, mission_id, user_id, title, description, is_next)
    if not rows:
        return None
    return await _get_mission(user_id, mission_id)


async def update_mission_step(
    step_id: int,
    user_id: int,
    title: str,
    description: str | None,
    is_next: bool,
    position: int,
) -> dict | None:
    query = """
        with target_step as (
            select s.id, s.mission_id
            from mission_steps s
            join missions m on m.id = s.mission_id
            where s.id = $1
              and m.user_id = $2
        ),
        lock_mission as (
            select pg_advisory_xact_lock((9032::bigint * 4294967296) + (target_step.mission_id::bigint & 4294967295))
            from target_step
        ),
        reset_next as (
            update mission_steps
            set is_next = false,
                updated_at = now()
            where mission_id = (select mission_id from target_step)
              and id <> $1
              and is_next = true
              and $5::boolean = true
              and exists (select 1 from lock_mission)
            returning id
        ),
        updated as (
            update mission_steps s
            set
                title = $3,
                description = $4,
                is_next = $5,
                position = greatest(1, $6),
                updated_at = now()
            from target_step
            left join lateral (select 1 from reset_next limit 1) rn on true
            where s.id = target_step.id
            returning target_step.mission_id
        )
        select mission_id from updated
    """
    rows = await db.execute(query, step_id, user_id, title, description, is_next, position)
    if not rows:
        return None
    return await _get_mission(user_id, rows[0]["mission_id"])


async def delete_mission_step(step_id: int, user_id: int) -> bool:
    query = """
        delete from mission_steps s
        using missions m
        where s.id = $1
          and m.id = s.mission_id
          and m.user_id = $2
        returning s.id
    """
    rows = await db.execute(query, step_id, user_id)
    return bool(rows)
