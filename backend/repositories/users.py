from databases.postgres import db


USER_COLUMNS = """
id,
username,
password_hash,
created_at,
updated_at
"""


async def get_user_by_username(username: str) -> dict | None:
    query = f"""
        select {USER_COLUMNS}
        from users
        where username = $1
        limit 1
    """
    rows = await db.execute(query, username)
    if not rows:
        return None
    return rows[0]


async def get_user_by_id(user_id: int) -> dict | None:
    query = f"""
        select {USER_COLUMNS}
        from users
        where id = $1
        limit 1
    """
    rows = await db.execute(query, user_id)
    if not rows:
        return None
    return rows[0]


async def create_user(username: str, password_hash: str) -> dict | None:
    query = f"""
        insert into users (username, password_hash)
        values ($1, $2)
        returning {USER_COLUMNS}
    """
    rows = await db.execute(query, username, password_hash)
    if not rows:
        return None
    return rows[0]
