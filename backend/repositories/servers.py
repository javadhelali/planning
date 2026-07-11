from databases.postgres import db


SERVER_COLUMNS = """
id,
user_id,
name,
host,
port,
username,
key_path,
position,
created_at,
updated_at
"""


async def list_servers(user_id: int) -> list[dict]:
    query = f"""
        select {SERVER_COLUMNS}
        from servers
        where user_id = $1
        order by position asc, created_at asc
    """
    rows = await db.execute(query, user_id)
    return rows or []


async def find_server_by_ref(ref: str) -> dict | None:
    """Resolve a server by name or numeric id, without user scoping.

    Used by the agent-facing MCP, which acts on the owner's behalf.
    """
    cleaned = ref.strip()
    rows = await db.execute(
        f"select {SERVER_COLUMNS} from servers where name = $1 order by id asc limit 1",
        cleaned,
    )
    if not rows and cleaned.isdigit():
        rows = await db.execute(
            f"select {SERVER_COLUMNS} from servers where id = $1",
            int(cleaned),
        )
    if not rows:
        return None
    return rows[0]


async def list_all_servers() -> list[dict]:
    """All servers across users, for the agent-facing MCP."""
    query = f"select {SERVER_COLUMNS} from servers order by id asc"
    rows = await db.execute(query)
    return rows or []


async def get_server(server_id: int, user_id: int) -> dict | None:
    query = f"""
        select {SERVER_COLUMNS}
        from servers
        where id = $1
          and user_id = $2
    """
    rows = await db.execute(query, server_id, user_id)
    if not rows:
        return None
    return rows[0]


async def create_server(
    user_id: int,
    name: str,
    host: str,
    port: int,
    username: str | None,
    key_path: str | None,
) -> dict | None:
    query = f"""
        with next_pos as (
            select coalesce(max(position), 0) + 1 as position
            from servers
            where user_id = $1
        ),
        inserted as (
            insert into servers (user_id, name, host, port, username, key_path, position)
            select $1, $2, $3, $4, $5, $6, next_pos.position
            from next_pos
            returning {SERVER_COLUMNS}
        )
        select * from inserted
    """
    rows = await db.execute(query, user_id, name, host, port, username, key_path)
    if not rows:
        return None
    return rows[0]


async def update_server(
    server_id: int,
    user_id: int,
    name: str,
    host: str,
    port: int,
    username: str | None,
    key_path: str | None,
    position: int,
) -> dict | None:
    query = f"""
        update servers
        set
            name = $3,
            host = $4,
            port = $5,
            username = $6,
            key_path = $7,
            position = greatest(1, $8),
            updated_at = now()
        where id = $1
          and user_id = $2
        returning {SERVER_COLUMNS}
    """
    rows = await db.execute(query, server_id, user_id, name, host, port, username, key_path, position)
    if not rows:
        return None
    return rows[0]


async def delete_server(server_id: int, user_id: int) -> bool:
    query = "delete from servers where id = $1 and user_id = $2 returning id"
    rows = await db.execute(query, server_id, user_id)
    return bool(rows)
