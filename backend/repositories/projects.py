import re

from databases.postgres import db


PROJECT_COLUMNS = """
p.id,
p.user_id,
p.server_id,
p.name,
p.slug,
p.description,
p.kind,
p.root_path,
p.position,
p.created_at,
p.updated_at,
s.name as server_name,
s.host as server_host
"""


def slugify(name: str) -> str:
    """A URL-friendly slug: lowercase, non-alphanumeric runs collapsed to dashes."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug or "project"


async def _unique_slug(user_id: int, base: str, exclude_id: int | None = None) -> str:
    """`base`, or `base-2`, `base-3`… so slugs are unique per user."""
    rows = await db.execute(
        "select slug from projects where user_id = $1 and ($2::int is null or id <> $2)",
        user_id,
        exclude_id,
    )
    taken = {row["slug"] for row in (rows or []) if row.get("slug")}
    if base not in taken:
        return base
    index = 2
    while f"{base}-{index}" in taken:
        index += 1
    return f"{base}-{index}"


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


async def get_project_by_slug(slug: str, user_id: int) -> dict | None:
    query = f"""
        select {PROJECT_COLUMNS}
        from projects p
        left join servers s on s.id = p.server_id
        where p.slug = $1
          and p.user_id = $2
    """
    rows = await db.execute(query, slug, user_id)
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

    slug = await _unique_slug(user_id, slugify(name))
    query = """
        with next_pos as (
            select coalesce(max(position), 0) + 100 as position
            from projects
            where user_id = $1
        ),
        inserted as (
            insert into projects (user_id, server_id, name, slug, description, kind, root_path, position)
            select $1, $2, $3, $4, $5, $6, $7, next_pos.position
            from next_pos
            returning id
        )
        select id from inserted
    """
    rows = await db.execute(query, user_id, server_id, name, slug, description, kind, root_path)
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

    slug = await _unique_slug(user_id, slugify(name), exclude_id=project_id)
    query = """
        update projects
        set
            server_id = $3,
            name = $4,
            description = $5,
            kind = $6,
            root_path = $7,
            position = greatest(1, $8),
            slug = $9,
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
    """
    rows = await db.execute(query, project_id, user_id, server_id, name, description, kind, root_path, position, slug)
    if not rows:
        return None
    return await get_project(project_id, user_id)


async def delete_project(project_id: int, user_id: int) -> bool:
    query = "delete from projects where id = $1 and user_id = $2 returning id"
    rows = await db.execute(query, project_id, user_id)
    return bool(rows)
