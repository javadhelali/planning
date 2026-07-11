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


class SendTextRequest(BaseModel):
    target: str = Field(min_length=1, max_length=400)
    text: str = Field(max_length=8000)
    enter: bool = True


class SendKeyRequest(BaseModel):
    target: str = Field(min_length=1, max_length=400)
    key: str = Field(min_length=1, max_length=40)


class CreateSessionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    command: str = Field(default="bash", max_length=1000)
    cwd: str | None = Field(default=None, max_length=1024)


async def _require_server(server_id: int, user: dict) -> dict:
    server = await get_server(server_id, user["id"])
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


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
    result = await ssh.tmux_capture_pane(server, target, lines=lines)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    if result.get("exit_status") not in (0, None):
        return {"ok": False, "error": (result.get("stderr") or "").strip() or "Capture failed"}
    return {"ok": True, "text": result.get("stdout") or ""}


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
    command = payload.command.strip() or "bash"
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
