"""Live tmux control for a server's sessions/windows/panes.

Reads and drives tmux over SSH via external/ssh. Server access is scoped to the
authenticated user (they can only touch servers they defined). tmux itself is the
source of truth — these endpoints just reflect and command it.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from external import ssh
from repositories.servers import get_server

router = APIRouter(prefix="/planning", tags=["tmux"])


class PaneModel(BaseModel):
    index: int
    active: bool
    command: str
    current_path: str = ""


class WindowModel(BaseModel):
    index: int
    name: str
    active: bool
    panes_count: int
    panes: list[PaneModel]


class SessionModel(BaseModel):
    name: str
    windows_count: int
    activity: int
    attached: bool
    windows: list[WindowModel]


class SessionsResponse(BaseModel):
    ok: bool
    error: str | None = None
    sessions: list[SessionModel] = []


class CaptureResponse(BaseModel):
    ok: bool
    error: str | None = None
    text: str = ""


class ActionResponse(BaseModel):
    ok: bool
    error: str | None = None


class HistoryItem(BaseModel):
    command: str
    count: int


class HistoryResponse(BaseModel):
    ok: bool
    error: str | None = None
    items: list[HistoryItem] = []


class SendTextRequest(BaseModel):
    target: str = Field(min_length=1, max_length=400)
    text: str = Field(max_length=8000)
    enter: bool = True


class SendKeyRequest(BaseModel):
    target: str = Field(min_length=1, max_length=400)
    key: str = Field(min_length=1, max_length=40)


class CreateSessionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Empty (the default) launches the server's default shell — usually zsh.
    command: str = Field(default="", max_length=1000)
    cwd: str | None = Field(default=None, max_length=1024)


async def _require_server(server_id: int, user: dict) -> dict:
    server = await get_server(server_id, user["id"])
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


def _parse_zsh_history(raw: str) -> list[str]:
    """Turn a raw zsh history dump into a chronological list of commands.

    Handles both plain lines and zsh's extended `: <ts>:<elapsed>;<command>`
    format. Blank lines are dropped; command text is returned verbatim.
    """
    commands: list[str] = []
    for line in raw.splitlines():
        if line.startswith(":"):
            semicolon = line.find(";")
            if semicolon != -1:
                line = line[semicolon + 1 :]
        stripped = line.strip()
        if stripped:
            commands.append(stripped)
    return commands


def _rank_history(commands: list[str], limit: int) -> list[dict[str, Any]]:
    """De-duplicate commands, ordering most-repeated first, then most-recent.

    `commands` must be in chronological (oldest → newest) order. Each unique
    command carries how many times it appears, so the UI can hint at frequency.
    """
    stats: dict[str, dict[str, int]] = {}
    for index, command in enumerate(commands):
        entry = stats.get(command)
        if entry is None:
            stats[command] = {"count": 1, "last": index}
        else:
            entry["count"] += 1
            entry["last"] = index
    ranked = sorted(stats.items(), key=lambda kv: (kv[1]["count"], kv[1]["last"]), reverse=True)
    return [{"command": command, "count": entry["count"]} for command, entry in ranked[:limit]]


def _action_result(result: dict[str, Any]) -> dict[str, Any]:
    """Fold an ssh run result into {ok, error}, treating non-zero exit as failure."""
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    if result.get("exit_status") not in (0, None):
        return {"ok": False, "error": (result.get("stderr") or "").strip() or "Command failed"}
    return {"ok": True, "error": None}


@router.get("/servers/{server_id}/sessions", response_model=SessionsResponse)
async def list_sessions(server_id: int, user: dict = Depends(require_authenticated_user)):
    server = await _require_server(server_id, user)
    return await ssh.list_tmux_tree(server)


@router.get("/servers/{server_id}/capture", response_model=CaptureResponse)
async def capture_pane(
    server_id: int,
    target: str,
    lines: int | None = Query(default=None, ge=1, le=20000),
    user: dict = Depends(require_authenticated_user),
):
    server = await _require_server(server_id, user)
    result = await ssh.tmux_capture_pane(server, target, lines=lines, color=True)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    if result.get("exit_status") not in (0, None):
        return {"ok": False, "error": (result.get("stderr") or "").strip() or "Capture failed"}
    return {"ok": True, "text": result.get("stdout") or ""}


@router.get("/servers/{server_id}/command-history", response_model=HistoryResponse)
async def command_history(
    server_id: int,
    limit: int = Query(default=300, ge=1, le=1000),
    user: dict = Depends(require_authenticated_user),
):
    """Ranked shell-command suggestions drawn from the server's zsh history."""
    server = await _require_server(server_id, user)
    result = await ssh.read_zsh_history(server)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    commands = _parse_zsh_history(result.get("stdout") or "")
    return {"ok": True, "items": _rank_history(commands, limit)}


@router.post("/servers/{server_id}/send-text", response_model=ActionResponse)
async def send_text(
    server_id: int,
    payload: SendTextRequest,
    user: dict = Depends(require_authenticated_user),
):
    server = await _require_server(server_id, user)
    result = await ssh.tmux_send_text(server, payload.target, payload.text, enter=payload.enter)
    return _action_result(result)


@router.post("/servers/{server_id}/send-key", response_model=ActionResponse)
async def send_key(
    server_id: int,
    payload: SendKeyRequest,
    user: dict = Depends(require_authenticated_user),
):
    server = await _require_server(server_id, user)
    result = await ssh.tmux_send_key(server, payload.target, payload.key)
    return _action_result(result)


@router.post("/servers/{server_id}/sessions", response_model=ActionResponse)
async def create_session(
    server_id: int,
    payload: CreateSessionRequest,
    user: dict = Depends(require_authenticated_user),
):
    server = await _require_server(server_id, user)
    command = payload.command.strip()
    cwd = (payload.cwd or "").strip() or None
    result = await ssh.tmux_new_session(server, payload.name.strip(), command, cwd=cwd)
    return _action_result(result)


@router.delete("/servers/{server_id}/sessions/{session}", response_model=ActionResponse)
async def kill_session(
    server_id: int,
    session: str,
    user: dict = Depends(require_authenticated_user),
):
    server = await _require_server(server_id, user)
    result = await ssh.tmux_kill_session(server, session)
    return _action_result(result)
