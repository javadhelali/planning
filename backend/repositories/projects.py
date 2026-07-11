from databases.postgres import db


PROJECT_COLUMNS = """
p.id,
p.user_id,
p.server_id,
p.name,
p.description,
p.kind,
p.root_path,
p.position,
p.created_at,
p.updated_at,
s.name as server_name,
s.host as server_host
"""


async def list_projects(user_id: int) -> list[dict]:
    query = f"""
        select {PROJECT_COLUMNS}
        from projects p
        left join servers s on s.id = p.server_id
        where p.user_id = $1
        order by p.position asc, p.created_at asc
    """
    rows = await db.execute(query, user_id)
    return rows or []


async def get_project(project_id: int, user_id: int) -> dict | None:
    query = f"""
        select {PROJECT_COLUMNS}
        from projects p
        left join servers s on s.id = p.server_id
        where p.id = $1
          and p.user_id = $2
    """
    rows = await db.execute(query, project_id, user_id)
    if not rows:
        return None
    return rows[0]


async def _owns_server(user_id: int, server_id: int) -> bool:
    rows = await db.execute(
        "select id from servers where id = $1 and user_id = $2",
        server_id,
        user_id,
    )
    return bool(rows)


async def create_project(
    user_id: int,
    server_id: int | None,
    name: str,
    description: str | None,
    kind: str,
    root_path: str | None,
) -> dict | None:
    if server_id is not None and not await _owns_server(user_id, server_id):
        return None

    query = """
        with next_pos as (
            select coalesce(max(position), 0) + 1 as position
            from projects
            where user_id = $1
        ),
        inserted as (
            insert into projects (user_id, server_id, name, description, kind, root_path, position)
            select $1, $2, $3, $4, $5, $6, next_pos.position
            from next_pos
            returning id
        )
        select id from inserted
    """
    rows = await db.execute(query, user_id, server_id, name, description, kind, root_path)
    if not rows:
        return None
    return await get_project(rows[0]["id"], user_id)


async def update_project(
    project_id: int,
    user_id: int,
    server_id: int | None,
    name: str,
    description: str | None,
    kind: str,
    root_path: str | None,
    position: int,
) -> dict | None:
    if server_id is not None and not await _owns_server(user_id, server_id):
        return None

    query = """
        update projects
        set
            server_id = $3,
            name = $4,
            description = $5,
            kind = $6,
            root_path = $7,
            position = greatest(1, $8),
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, project_id, user_id, server_id, name, description, kind, root_path, position)
    if not rows:
        return None
    return await get_project(project_id, user_id)


async def delete_project(project_id: int, user_id: int) -> bool:
    query = "delete from projects where id = $1 and user_id = $2 returning id"
    rows = await db.execute(query, project_id, user_id)
    return bool(rows)
