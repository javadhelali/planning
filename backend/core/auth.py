from __future__ import annotations

from config import settings
from databases.redis import redis_client
from repositories.users import create_user, get_user_by_id, get_user_by_username
from utilities.security import generate_session_token, hash_password, verify_password


def normalize_username(username: str) -> str:
    return username.strip().lower()


def _session_key(token: str) -> str:
    return f"planning:session:{token}"


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
    }


async def register_user(username: str, password: str) -> dict:
    normalized_username = normalize_username(username)
    existing_user = await get_user_by_username(normalized_username)
    if existing_user is not None:
        raise ValueError("Username already exists")

    user = await create_user(normalized_username, hash_password(password))
    if user is None:
        raise RuntimeError("Failed to create user")
    return _public_user(user)


async def authenticate_user(username: str, password: str) -> dict | None:
    normalized_username = normalize_username(username)
    user = await get_user_by_username(normalized_username)
    if user is None:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return _public_user(user)


async def create_user_session(user_id: int) -> str:
    token = generate_session_token()
    await redis_client.setex(_session_key(token), settings.auth_session_ttl_seconds, str(user_id))
    return token


async def get_user_by_session(token: str) -> dict | None:
    user_id = await redis_client.get(_session_key(token))
    if user_id is None:
        return None
    if not user_id.isdigit():
        await redis_client.delete(_session_key(token))
        return None

    user = await get_user_by_id(int(user_id))
    if user is None:
        await redis_client.delete(_session_key(token))
        return None
    return _public_user(user)


async def revoke_user_session(token: str) -> bool:
    deleted = await redis_client.delete(_session_key(token))
    return deleted > 0
