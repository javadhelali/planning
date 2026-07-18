"""SSH pipeline client for running commands and managing tmux on remote servers.

All communication with remote servers goes through here. Authentication is
public-key only: pass a private key path or fall back to the local default key.

Connections are **pooled and reused** per server: the frontend polls
`capture-pane` every ~1.2s, and dialing a fresh TCP + SSH + key-auth handshake
each time (against a possibly-overseas host) is what made the terminals page
feel slow. A warm connection turns each poll into a single channel open. Dead
peers are detected via keepalives and transparently re-dialed.
"""

from __future__ import annotations

import asyncio
import os
import shlex
from typing import Any

import asyncssh

from config import settings

# Keepalive so a silently-dropped peer is noticed and the pooled connection is
# torn down (asyncssh raises on the next use) instead of hanging.
_KEEPALIVE_INTERVAL = 15
_KEEPALIVE_COUNT_MAX = 3

# One live connection per (host, port, username, key), plus a per-key lock so
# concurrent polls share a single dial instead of racing to open duplicates.
_pool: dict[tuple[str, int, str | None, str], asyncssh.SSHClientConnection] = {}
_locks: dict[tuple[str, int, str | None, str], asyncio.Lock] = {}


def _resolve_key(key_path: str | None) -> str:
    """The private key to authenticate with: the server's own, else the default.

    The default is configurable because "~" is the *backend's* home — inside a
    container that is /root, not the operator's home directory, so the key has to
    be mounted in and pointed at explicitly (see SSH_KEY_PATH).
    """
    return os.path.expanduser(key_path or settings.ssh_key_path)


def _client_keys(key_path: str | None) -> list[str]:
    return [_resolve_key(key_path)]


def _pool_key(server: dict[str, Any]) -> tuple[str, int, str | None, str]:
    return (
        server["host"],
        server.get("port") or 22,
        server.get("username") or None,
        _resolve_key(server.get("key_path")),
    )


def _lock_for(key: tuple[str, int, str | None, str]) -> asyncio.Lock:
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    return lock


async def _connect(server: dict[str, Any], timeout: int) -> asyncssh.SSHClientConnection:
    return await asyncssh.connect(
        host=server["host"],
        port=server.get("port") or 22,
        username=server.get("username") or None,
        client_keys=_client_keys(server.get("key_path")),
        known_hosts=None,  # host-key pinning is a later hardening step
        connect_timeout=timeout,
        keepalive_interval=_KEEPALIVE_INTERVAL,
        keepalive_count_max=_KEEPALIVE_COUNT_MAX,
    )


async def _get_connection(server: dict[str, Any], timeout: int) -> asyncssh.SSHClientConnection:
    """Return a pooled, healthy connection for this server, dialing if needed."""
    key = _pool_key(server)
    async with _lock_for(key):
        conn = _pool.get(key)
        if conn is not None and not conn.is_closed():
            return conn
        # No connection, or a stale/closed one — (re)dial and cache it.
        _pool.pop(key, None)
        conn = await _connect(server, timeout)
        _pool[key] = conn
        return conn


def _evict(server: dict[str, Any]) -> None:
    key = _pool_key(server)
    conn = _pool.pop(key, None)
    if conn is not None:
        conn.abort()


async def close_all() -> None:
    """Tear down every pooled connection (call on app shutdown)."""
    conns = list(_pool.values())
    _pool.clear()
    for conn in conns:
        conn.abort()
    for conn in conns:
        try:
            await conn.wait_closed()
        except (OSError, asyncssh.Error):
            pass


def remote_path(path: str) -> str:
    """Shell-safe path that still lets a leading ~ expand on the remote host."""
    path = path.strip()
    if path == "~":
        return "$HOME"
    if path.startswith("~/"):
        return '"$HOME"/' + shlex.quote(path[2:])
    return shlex.quote(path)


async def run_command(server: dict[str, Any], command: str, timeout: int = 30) -> dict[str, Any]:
    """Run an arbitrary shell command on a server over a pooled SSH connection.

    `server` needs: host, port, username (optional), key_path (optional).
    Returns {ok, exit_status, stdout, stderr} or {ok: False, error} on failure.
    Reuses a warm connection; if it turns out to be dead, evicts it and re-dials
    once so a transient drop doesn't surface as an error.
    """
    key = _resolve_key(server.get("key_path"))
    if not os.path.isfile(key):
        # asyncssh would raise a bare FileNotFoundError here, which tells the
        # operator nothing. Name the path and the setting that controls it.
        return {
            "ok": False,
            "error": (
                f"SSH key not found at {key}. Mount the key into the backend and point "
                f"SSH_KEY_PATH at it (or set the server's key_path)."
            ),
        }

    last_exc: Exception | None = None
    # Attempt on the pooled connection; on failure evict and dial fresh once.
    for attempt in range(2):
        try:
            conn = await _get_connection(server, timeout)
            result = await conn.run(command, check=False, timeout=timeout)
            return {
                "ok": True,
                "exit_status": result.exit_status,
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
            }
        except (OSError, asyncssh.Error, TimeoutError) as exc:
            last_exc = exc
            _evict(server)
    return {"ok": False, "error": f"{type(last_exc).__name__}: {last_exc}"}


# ---- tmux helpers -----------------------------------------------------------
# Each builds a tmux CLI invocation and runs it via run_command. tmux keeps the
# session/PTY alive on the server independently of this SSH connection.


async def tmux_new_session(
    server: dict[str, Any],
    session: str,
    command: str = "",
    cwd: str | None = None,
    width: int = 200,
    height: int = 50,
) -> dict[str, Any]:
    """Create a detached tmux session at a fixed size.

    With `command` empty, tmux launches the server's default shell (usually
    zsh); otherwise it runs `command` in the pane.
    """
    parts = ["tmux", "new-session", "-d", "-s", shlex.quote(session), "-x", str(width), "-y", str(height)]
    if cwd:
        parts += ["-c", remote_path(cwd)]
    if command:
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
    "#{pane_title}",
    "#{pane_current_path}",
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
        if len(parts) < 12:
            continue
        (s_name, s_windows, s_activity, s_attached, w_index, w_name, w_active, w_panes, p_index, p_active, p_cmd, p_title) = parts[:12]
        # pane_current_path is last; rejoin in the unlikely case a path holds a tab.
        p_path = "\t".join(parts[12:]) if len(parts) > 12 else ""

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
                "title": p_title,
                "current_path": p_path,
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
    color: bool = False,
) -> dict[str, Any]:
    """Capture a pane's text.

    Without `lines`, returns only the current visible grid (a short pane yields
    few lines). With `lines`, adds `-S -<lines>` to include that much scrollback
    history — useful when the pane is only a few rows tall. History only exists
    for normal (non-alternate-screen) panes.

    `color` adds `-e`, which preserves the pane's ANSI escape sequences
    (colors/attributes). Only human-facing consumers (the frontend, which
    parses them into colored output) want this. Keep it off for callers that
    feed the text to an LLM — the raw escape codes are noise there.
    """
    command = f"tmux capture-pane -t {shlex.quote(target)} -p"
    if color:
        command += " -e"
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


async def read_zsh_history(server: dict[str, Any], limit: int = 3000) -> dict[str, Any]:
    """Read the most recent `limit` lines of the server's zsh history file.

    Prefers ~/.zsh_history, falling back to ~/.histfile. Returns the raw file
    text (which may be in zsh's extended `: <ts>:<elapsed>;<command>` format);
    parsing, de-duplication and ranking happen in the caller. Best-effort: a
    missing file yields empty stdout rather than an error.
    """
    n = max(1, int(limit))
    command = (
        'f="$HOME/.zsh_history"; [ -f "$f" ] || f="$HOME/.histfile"; '
        f'tail -n {n} "$f" 2>/dev/null || true'
    )
    return await run_command(server, command)
