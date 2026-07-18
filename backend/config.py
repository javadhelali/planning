import os
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "FastAPI App"
    debug: bool = True

    # Database
    database_url: str = "postgresql://postgres:7NB05789o7uytOI@127.0.0.1:5498/planning"

    # Redis
    redis_url: str = "redis://127.0.0.1:6032/0"
    auth_session_ttl_seconds: int = 60 * 60 * 24 * 7

    # Private key used to reach the managed servers, when a server doesn't name
    # its own. "~" is the backend's home — in a container that's /root, so in
    # production mount the key in and point this at the mounted path.
    ssh_key_path: str = "~/.ssh/id_ed25519"

    # How to launch Claude Code on a server. `claudep` is a zsh alias for a
    # function that exports the sing-box proxy and then runs claude — and claude
    # itself is only on the interactive PATH (nvm). Both live in ~/.zshrc, which
    # tmux's `sh -c` never sources, so the command is run through an interactive
    # login shell. Override either half per deployment.
    agent_command: str = "claudep"
    agent_shell: str = "zsh"

    # CORS
    allowed_origins: list[str] = ["http://localhost:3038", "http://212.80.24.87:3038", "http://questboard.ir", "https://questboard.ir"]

    # OpenRouter
    openrouter_api_key: str = ""

    # Soniox (speech-to-text). The key stays server-side — the browser streams
    # audio to us and we relay it to Soniox.
    soniox_api_key: str = ""
    soniox_model: str = "stt-rt-v5"
    # Proxy for the outbound Soniox websocket: socks5h://, socks5://, socks4://,
    # http:// or https://. Falls back to global_access_http_proxy when unset;
    # set to "direct" to bypass the global proxy for Soniox only.
    soniox_proxy: Optional[str] = None

    global_access_http_proxy: Optional[str] = None

    class Config:
        env_file = os.getenv("ENV_FILE", "dev.env")
        env_file_encoding = "utf-8"


settings = Settings()
