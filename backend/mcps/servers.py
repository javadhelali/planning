"""MCP server exposing SSH + tmux control over the servers defined in the DB.

Runs alongside the postgres MCP. Every tool takes a `server` argument which is
either the server's name or its numeric id (as stored in the `servers` table);
connection details and the SSH key are looked up from the database.
"""

from typing import Any

from mcp.server.fastmcp import FastMCP

from external.ssh import (
    run_command,
    tmux_capture_pane,
    tmux_kill_session,
    tmux_list_sessions,
    tmux_new_session,
    tmux_send_key,
    tmux_send_text,
)
from repositories.servers import find_server_by_ref, list_all_servers

mcp = FastMCP("servers")

SERVER_NOT_FOUND = "No server found with that name or id. Use list_servers to see defined servers."


async def _resolve(server: str) -> dict[str, Any] | None:
    return await find_server_by_ref(server)


@mcp.tool()
async def list_servers() -> list[dict[str, Any]]:
    """List all servers defined in the database (name, host, port, username)."""
    servers = await list_all_servers()
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "host": s["host"],
            "port": s["port"],
            "username": s["username"],
        }
        for s in servers
    ]


@mcp.tool()
async def run_server_command(server: str, command: str, timeout: int = 30) -> dict[str, Any]:
    """Run an arbitrary shell command on a server over SSH.

    Examples: "nproc", "top -bn1 | head", "df -h /", "free -m".
    Returns {ok, exit_status, stdout, stderr}.
    """
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await run_command(resolved, command, timeout=timeout)


@mcp.tool()
async def tmux_start(
    server: str,
    session: str,
    command: str,
    cwd: str | None = None,
    width: int = 200,
    height: int = 50,
) -> dict[str, Any]:
    """Create a detached tmux session running `command` (optionally in `cwd`)."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_new_session(resolved, session, command, cwd=cwd, width=width, height=height)


@mcp.tool()
async def tmux_sessions(server: str) -> dict[str, Any]:
    """List tmux sessions on a server (name, last activity, current command)."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_list_sessions(resolved)


@mcp.tool()
async def tmux_capture(server: str, session: str) -> dict[str, Any]:
    """Capture the current visible screen of a tmux session's pane."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_capture_pane(resolved, session)


@mcp.tool()
async def tmux_type(server: str, session: str, text: str, enter: bool = True) -> dict[str, Any]:
    """Type literal text into a tmux session, optionally pressing Enter after."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_send_text(resolved, session, text, enter=enter)


@mcp.tool()
async def tmux_key(server: str, session: str, key: str) -> dict[str, Any]:
    """Send a single named key/chord to a tmux session (Enter, C-c, Escape, Up, ...)."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_send_key(resolved, session, key)


@mcp.tool()
async def tmux_stop(server: str, session: str) -> dict[str, Any]:
    """Kill a tmux session on a server."""
    resolved = await _resolve(server)
    if resolved is None:
        return {"ok": False, "error": SERVER_NOT_FOUND}
    return await tmux_kill_session(resolved, session)


if __name__ == "__main__":
    mcp.run()
