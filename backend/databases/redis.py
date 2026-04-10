import redis.asyncio as redis
from redis.asyncio import Redis

from config import settings


class RedisClient:
    def __init__(self, url: str):
        self._client: Redis = redis.from_url(url, decode_responses=True)

    async def setex(self, key: str, ttl_seconds: int, value: str) -> bool:
        return bool(await self._client.setex(key, ttl_seconds, value))

    async def get(self, key: str) -> str | None:
        return await self._client.get(key)

    async def delete(self, key: str) -> int:
        return int(await self._client.delete(key))

    async def rpush(self, key: str, value: str) -> int:
        return int(await self._client.rpush(key, value))

    async def blpop(self, key: str, timeout: int = 0) -> tuple[str, str] | None:
        result = await self._client.blpop(key, timeout=timeout)
        if result is None:
            return None
        return result[0], result[1]

    async def llen(self, key: str) -> int:
        return int(await self._client.llen(key))


redis_client = RedisClient(settings.redis_url)
