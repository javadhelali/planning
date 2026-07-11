"""SSH pipeline client for running commands and managing tmux on remote servers.

All communication with remote servers goes through here. Authentication is
public-key only: pass a private key path or fall back to the local default key.
A fresh connection is opened per call — simple and stateless, which is the right
trade-off for occasional agent-driven commands (not high-frequency polling).
"""

from __future__ import annotations

import os
import shlex
from typing import Any

import asyncssh

DEFAULT_KEY_PATH = "~/.ssh/id_ed25519"


def _client_keys(key_path: str | None) -> list[str]:
    path = key_path or DEFAULT_KEY_PATH
    return [os.path.expanduser(path)]


async def run_command(server: dict[str, Any], command: str, timeout: int = 30) -> dict[str, Any]:
    """Run an arbitrary shell command on a server.

    `server` needs: host, port, username (optional), key_path (optional).
    Returns {ok, exit_status, stdout, stderr} or {ok: False, error} on failure.
    """
    try:
        async with asyncssh.connect(
            host=server["host"],
            port=server.get("port") or 22,
            username=server.get("username") or None,
            client_keys=_client_keys(server.get("key_path")),
            known_hosts=None,  # host-key pinning is a later hardening step
            connect_timeout=timeout,
        ) as conn:
            result = await conn.run(command, check=False, timeout=timeout)
            return {
                "ok": True,
                "exit_status": result.exit_status,
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
            }
    except (OSError, asyncssh.Error, TimeoutError) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ---- tmux helpers -----------------------------------------------------------
# Each builds a tmux CLI invocation and runs it via run_command. tmux keeps the
# session/PTY alive on the server independently of this SSH connection.


async def tmux_new_session(
    server: dict[str, Any],
    session: str,
    command: str,
    cwd: str | None = None,
    width: int = 200,
    height: int = 50,
) -> dict[str, Any]:
    """Create a detached tmux session at a fixed size running `command`."""
    parts = ["tmux", "new-session", "-d", "-s", shlex.quote(session), "-x", str(width), "-y", str(height)]
    if cwd:
        parts += ["-c", shlex.quote(cwd)]
    parts.append(shlex.quote(command))
    return await run_command(server, " ".join(parts))


async def tmux_list_sessions(server: dict[str, Any]) -> dict[str, Any]:
    """List tmux sessions with last activity and current command."""
    fmt = "#{session_name}\t#{session_activity}\t#{pane_current_command}"
    return await run_command(server, f"tmux list-sessions -F {shlex.quote(fmt)}")


_TREE_FIELDS = [
    "#{session_name}",
    "#{session_windows}",
    "#{session_activity}",
    "#{session_attached}",
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{window_panes}",
    "#{pane_index}",
    "#{pane_active}",
    "#{pane_current_command}",
]


def _to_int(value: str, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def list_tmux_tree(server: dict[str, Any]) -> dict[str, Any]:
    """Return the full session -> window -> pane tree for a server.

    One `tmux list-panes -a` call yields every pane with its session/window
    context, which we fold into a nested structure. Returns
    {ok, sessions} on success, or {ok: False, error} if SSH itself failed.
    A reachable server with no tmux server running yields {ok: True, sessions: []}.
    """
    fmt = "\t".join(_TREE_FIELDS)
    result = await run_command(server, f"tmux list-panes -a -F {shlex.quote(fmt)}")

    if not result["ok"]:
        return {"ok": False, "error": result["error"], "sessions": []}

    stdout = result.get("stdout") or ""
    if result.get("exit_status") not in (0, None) and not stdout.strip():
        # e.g. "no server running on /tmp/tmux-*/default" — reachable, just empty.
        return {"ok": True, "sessions": []}

    sessions: dict[str, dict[str, Any]] = {}
    for line in stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 11:
            continue
        (s_name, s_windows, s_activity, s_attached, w_index, w_name, w_active, w_panes, p_index, p_active, p_cmd) = parts[:11]

        session = sessions.get(s_name)
        if session is None:
            session = {
                "name": s_name,
                "windows_count": _to_int(s_windows),
                "activity": _to_int(s_activity),
                "attached": s_attached == "1",
                "_windows": {},
            }
            sessions[s_name] = session

        window = session["_windows"].get(w_index)
        if window is None:
            window = {
                "index": _to_int(w_index),
                "name": w_name,
                "active": w_active == "1",
                "panes_count": _to_int(w_panes),
                "panes": [],
            }
            session["_windows"][w_index] = window

        window["panes"].append(
            {
                "index": _to_int(p_index),
                "active": p_active == "1",
                "command": p_cmd,
            }
        )

    out: list[dict[str, Any]] = []
    for session in sessions.values():
        windows = sorted(session.pop("_windows").values(), key=lambda w: w["index"])
        for window in windows:
            window["panes"].sort(key=lambda p: p["index"])
        session["windows"] = windows
        out.append(session)
    out.sort(key=lambda s: s["name"])

    return {"ok": True, "sessions": out}


async def tmux_capture_pane(
    server: dict[str, Any],
    target: str,
    lines: int | None = None,
) -> dict[str, Any]:
    """Capture a pane's text.

    Without `lines`, returns only the current visible grid (a short pane yields
    few lines). With `lines`, adds `-S -<lines>` to include that much scrollback
    history — useful when the pane is only a few rows tall. History only exists
    for normal (non-alternate-screen) panes.
    """
    command = f"tmux capture-pane -t {shlex.quote(target)} -p"
    if lines and lines > 0:
        command += f" -S -{int(lines)}"
    return await run_command(server, command)


async def tmux_send_text(
    server: dict[str, Any],
    session: str,
    text: str,
    enter: bool = True,
) -> dict[str, Any]:
    """Type literal text into a session, optionally followed by Enter."""
    target = shlex.quote(session)
    command = f"tmux send-keys -t {target} -l {shlex.quote(text)}"
    if enter:
        command += f" && tmux send-keys -t {target} Enter"
    return await run_command(server, command)


async def tmux_send_key(server: dict[str, Any], session: str, key: str) -> dict[str, Any]:
    """Send a single named key/chord to a session (e.g. Enter, C-c, Escape, Up)."""
    return await run_command(server, f"tmux send-keys -t {shlex.quote(session)} {shlex.quote(key)}")


async def tmux_kill_session(server: dict[str, Any], session: str) -> dict[str, Any]:
    """Kill a tmux session."""
    return await run_command(server, f"tmux kill-session -t {shlex.quote(session)}")
