from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "FastAPI App"
    debug: bool = True

    # Database
    database_url: str = "postgresql://postgres:7NB05789o7uytOI@127.0.0.1:5498/planning"

    # Redis
    redis_url: str = "redis://127.0.0.1:6034/0"
    auth_session_ttl_seconds: int = 60 * 60 * 24 * 7

    # CORS
    allowed_origins: list[str] = ["http://localhost:3038", "http://212.80.24.87:3038"]

    # OpenRouter
    openrouter_api_key: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
