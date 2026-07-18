"""Drive a Claude Code agent inside a tmux pane on a server.

Finds the Claude session for a project — a pane already running `claude` under
the project root — or starts one, then types the prompt into it. Everything goes
through tmux over SSH, so the terminal stays the source of truth: the user can
watch the agent work and take over the pane at any time.
"""

import asyncio
import re
import shlex
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from config import settings
from external import ssh
from repositories.projects import get_project
from repositories.servers import get_server

router = APIRouter(prefix="/planning", tags=["agent"])

# Sessions this feature creates are named "claude-<slug>", which also makes them
# easy to recognise on a later run.
SESSION_PREFIX = "claude"

# Claude Code exposes no machine-readable model list, so this is a curated set of
# the aliases its `--model` flag and `/model` command accept. Keep it in sync
# with the CLI; an empty id means "don't override the CLI's configured default".
AGENT_MODELS: list[dict[str, str]] = [
    {
        "id": "",
        "label": "Default",
        "hint": "recommended",
        "description": "Whatever the CLI is already configured to use.",
    },
    {
        "id": "opus",
        "label": "Opus",
        "hint": "claude-opus-4-8",
        "description": "Most capable. Complex refactors and long autonomous runs.",
    },
    {
        "id": "sonnet",
        "label": "Sonnet",
        "hint": "claude-sonnet-5",
        "description": "Balanced speed and capability. Good for daily work.",
    },
    {
        "id": "haiku",
        "label": "Haiku",
        "hint": "claude-haiku-4-5",
        "description": "Fastest and cheapest. Short, well-scoped tasks.",
    },
]

# Only these may reach the shell — the model is interpolated into a command.
_ALLOWED_MODELS = {model["id"] for model in AGENT_MODELS if model["id"]}

# How long to let a freshly-spawned `claude` boot before typing into it.
_BOOT_SECONDS = 5.0
# Pause after a slash command so the CLI has processed it before the next send.
_SLASH_SECONDS = 1.5


# --- schemas -----------------------------------------------------------------


class AgentModel(BaseModel):
    id: str
    label: str
    hint: str = ""
    description: str = ""


class AgentModelsResponse(BaseModel):
    models: list[AgentModel]


class AgentSessionResponse(BaseModel):
    ok: bool
    error: str | None = None
    target: str | None = None


class AgentRunRequest(BaseModel):
    server_id: int
    project_id: int | None = None
    prompt: str = Field(min_length=1, max_length=20000)
    clear: bool = False
    model: str = Field(default="", max_length=64)


class AgentRunResponse(BaseModel):
    ok: bool
    error: str | None = None
    target: str | None = None
    created: bool = False


# --- helpers -----------------------------------------------------------------


async def _require_server(server_id: int, user: dict) -> dict:
    server = await get_server(server_id, user["id"])
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


async def _resolve(server_id: int, project_id: int | None, user: dict) -> tuple[dict, str | None]:
    """Return the server plus the project's root path (None = the home directory)."""
    server = await _require_server(server_id, user)
    if project_id is None:
        return server, None
    project = await get_project(project_id, user["id"])
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.get("server_id") != server_id:
        raise HTTPException(status_code=400, detail="Project is not on that server")
    return server, (project.get("root_path") or "").strip() or None


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", text).strip("-")
    return cleaned or "agent"


def _path_under(pane_path: str | None, root: str | None) -> bool:
    """Is `pane_path` inside `root`? Tolerant of a root written with a leading ~."""
    pane = (pane_path or "").rstrip("/")
    full = (root or "").rstrip("/")
    if not pane or not full:
        return False
    if pane == full or pane.startswith(f"{full}/"):
        return True
    # "~/app/code" also matches an absolute "/home/me/app/code".
    tail = full[1:] if full.startswith("~") else full
    if tail != full and tail not in ("", "/"):
        if pane == tail or pane.startswith(f"{tail}/") or pane.endswith(tail):
            return True
    return False


def _is_claude_pane(pane: dict[str, Any], session_name: str) -> bool:
    """Does this pane look like a running Claude Code session?

    tmux reports the foreground process, which is `claude` for the CLI. We also
    accept sessions we named ourselves, and panes whose title Claude Code set.
    """
    if (pane.get("command") or "").strip().lower() == "claude":
        return True
    if session_name.lower().startswith(f"{SESSION_PREFIX}-"):
        return True
    return "claude" in (pane.get("title") or "").lower()


async def _find_target(server: dict, root_path: str | None) -> tuple[str | None, str | None]:
    """Locate a running Claude pane. Returns (target, error)."""
    tree = await ssh.list_tmux_tree(server)
    if not tree.get("ok"):
        return None, tree.get("error") or "Could not reach the server."
    for session in tree.get("sessions") or []:
        name = session.get("name") or ""
        for window in session.get("windows") or []:
            for pane in window.get("panes") or []:
                if not _is_claude_pane(pane, name):
                    continue
                if root_path is not None:
                    # Project scope: the pane must actually sit inside the project.
                    if not _path_under(pane.get("current_path"), root_path):
                        continue
                elif not name.lower().startswith(f"{SESSION_PREFIX}-"):
                    # Server scope: only reuse a session we started, so we never
                    # hijack some other project's agent.
                    continue
                return f"{name}:{window['index']}.{pane['index']}", None
    return None, None


async def _unique_session_name(server: dict, base: str) -> str:
    tree = await ssh.list_tmux_tree(server)
    taken = {(session.get("name") or "") for session in (tree.get("sessions") or [])}
    name = f"{SESSION_PREFIX}-{_slug(base)}"
    if name not in taken:
        return name
    index = 2
    while f"{name}-{index}" in taken:
        index += 1
    return f"{name}-{index}"


def _launch_command(model: str, server: dict) -> str:
    """The shell command that starts Claude Code in a fresh pane.

    Wrapped in an interactive shell on purpose: the configured command is
    typically `claudep`, a zsh alias for a function that sets the outbound proxy
    before running claude, and claude itself usually sits on an nvm PATH. Both of
    those come from ~/.zshrc — and tmux launches commands with `sh -c`, which
    sources nothing, so a bare `claude` is simply "not found".

    Each server may override how Claude is launched (e.g. `cc` on the basalam
    WSL box); a blank per-server command falls back to the global default.
    """
    command = (server.get("command") or "").strip() or settings.agent_command
    if model:
        command = f"{command} --model {model}"
    return f"{settings.agent_shell} -ic {shlex.quote(command)}"


def _failed(result: dict[str, Any]) -> str | None:
    if not result.get("ok"):
        return result.get("error") or "SSH failed"
    if result.get("exit_status") not in (0, None):
        return (result.get("stderr") or "").strip() or "Command failed"
    return None


# --- routes ------------------------------------------------------------------


@router.get("/agent/models", response_model=AgentModelsResponse)
async def agent_models(user: dict = Depends(require_authenticated_user)):
    return {"models": AGENT_MODELS}


@router.get("/agent/session", response_model=AgentSessionResponse)
async def agent_session(
    server_id: int,
    project_id: int | None = Query(default=None),
    user: dict = Depends(require_authenticated_user),
):
    """The Claude pane currently serving this project/server, if any."""
    server, root_path = await _resolve(server_id, project_id, user)
    target, error = await _find_target(server, root_path)
    if error:
        return {"ok": False, "error": error}
    return {"ok": True, "target": target}


@router.post("/agent/run", response_model=AgentRunResponse)
async def agent_run(payload: AgentRunRequest, user: dict = Depends(require_authenticated_user)):
    """Send a prompt to the project's Claude session, starting one if needed."""
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is empty")
    model = payload.model.strip()
    if model and model not in _ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail="Unknown model")

    server, root_path = await _resolve(payload.server_id, payload.project_id, user)

    target, error = await _find_target(server, root_path)
    if error:
        return {"ok": False, "error": error}

    created = False
    if target is None:
        # No Claude here yet — open a terminal running it in the project root.
        base = root_path.rstrip("/").rsplit("/", 1)[-1] if root_path else (server.get("name") or "agent")
        name = await _unique_session_name(server, base)
        result = await ssh.tmux_new_session(server, name, _launch_command(model, server), cwd=root_path)
        failure = _failed(result)
        if failure:
            return {"ok": False, "error": failure}
        target = f"{name}:0.0"
        created = True
        # Give the CLI time to boot before typing into it.
        await asyncio.sleep(_BOOT_SECONDS)
    else:
        # Reusing a live session: apply the requested context/model first. A new
        # session already starts with a clean context and the right --model.
        if payload.clear:
            failure = _failed(await ssh.tmux_send_text(server, target, "/clear", enter=True))
            if failure:
                return {"ok": False, "error": failure}
            await asyncio.sleep(_SLASH_SECONDS)
        if model:
            failure = _failed(await ssh.tmux_send_text(server, target, f"/model {model}", enter=True))
            if failure:
                return {"ok": False, "error": failure}
            await asyncio.sleep(_SLASH_SECONDS)

    failure = _failed(await ssh.tmux_send_text(server, target, prompt, enter=True))
    if failure:
        return {"ok": False, "error": failure}
    return {"ok": True, "target": target, "created": created}
