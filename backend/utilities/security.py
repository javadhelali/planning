from __future__ import annotations

import hashlib
import hmac
import secrets


PBKDF2_ROUNDS = 100_000
PASSWORD_SCHEME = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ROUNDS,
    )
    return f"{PASSWORD_SCHEME}${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, salt, stored_digest = stored_hash.split("$", 2)
    except ValueError:
        return False

    if scheme != PASSWORD_SCHEME:
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ROUNDS,
    )
    return hmac.compare_digest(digest.hex(), stored_digest)


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)
