import asyncpg
from typing import Any

from config import settings


class PostgresClient:
    def __init__(self, database_url: str):
        self.database_url = database_url

    async def execute(self, query: str, *params: Any) -> list[dict] | None:
        conn = await asyncpg.connect(self.database_url)
        try:
            result = await conn.fetch(query, *params)
            if result:
                return [dict(row) for row in result]
            return None
        finally:
            await conn.close()


db = PostgresClient(settings.database_url)
