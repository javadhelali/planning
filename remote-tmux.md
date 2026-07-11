# Live tmux Agent Viewer — Implementation Spec

## 1. Goal

Build a local Python application that connects to a fixed list of SSH servers (IP,
port, public-key auth), runs interactive coding agents (`codex` and/or `claude`) inside
tmux on each server, and **mirrors the current tmux window — the live TUI screen exactly
as it looks right now — into a local interface**. The user must be able to view any
session's current screen on demand, see it refresh live while watching, and send input
(prompts, approvals, control keys) to it.

Explicitly **not** in scope: parsing JSON/headless (`codex exec --json`,
`claude -p --output-format stream-json`) event streams. We want the rendered terminal
screen, not structured event data.

Key property: the capture/render mechanism is **agent-agnostic**. It scrapes the terminal
grid, so it works identically for `codex`, `claude`, or any other full-screen TUI. Only
the launch command and one-time login differ per agent.

## 2. Core mechanism (why this design works)

The interactive agent TUIs need a real PTY and must survive disconnects. tmux provides
both: the agent runs inside a tmux pane (which owns the PTY), and the tmux **server**
process on the box keeps the session alive independently of any SSH connection.

That gives a clean split:

- **The PTY lives on the server, inside tmux.** We never allocate an interactive PTY
  over SSH for the agent itself.
- **Control is stateless request/response.** `tmux capture-pane`, `send-keys`,
  `list-sessions`, etc. are ordinary CLI commands. The local app runs them over SSH
  whenever it wants — the connection can come and go without affecting the session.
- **"Access its state at any time" = run `capture-pane` over SSH at any time.**

So the local app is a thin controller: hold SSH connections to the servers, issue tmux
commands, render whatever `capture-pane` returns.

## 3. Architecture

```
Local machine (Python)                       Server N (in the SSH list)
┌───────────────────────────┐                ┌──────────────────────────────┐
│ UI (xterm.js / Textual)   │                │ tmux server (persistent)     │
│        ▲    │ input        │                │  ┌────────────────────────┐  │
│        │    ▼              │  SSH (asyncssh) │  │ session "agent1"       │  │
│ Session manager           │◄──────────────► │  │  pane → PTY → `codex`  │  │
│  - persistent SSH conns   │  capture-pane   │  └────────────────────────┘  │
│  - poll / control-mode    │  send-keys      │  ┌────────────────────────┐  │
│  - screen buffers per     │  list-sessions  │  │ session "agent2"       │  │
│    (server, session)      │                 │  │  pane → PTY → `claude` │  │
└───────────────────────────┘                 │  └────────────────────────┘  │
                                              └──────────────────────────────┘
```

One tmux **session** per agent instance. The local app maintains one persistent SSH
connection per server and multiplexes all tmux traffic for that server over it.

## 4. Technology choices

- **SSH transport (local → servers): `asyncssh`.** Async, integrates with an asyncio
  event loop, supports persistent connections and running many commands/channels over
  one connection — ideal for fanning out across the server list and for tight polling.
  (`paramiko`/`fabric` are viable but synchronous; avoid for this workload.)
- **Session multiplexing on the server: tmux.** All PTY ownership, persistence, and
  screen capture come from tmux. No extra server-side daemon is required.
- **Screen rendering (local): `xterm.js`** in a small web frontend is the most faithful
  path — it is built to render exactly this kind of ANSI terminal output. If an all-Python
  desktop/TUI is required instead, use **`pyte`** (pure-Python terminal emulator) to turn
  captured bytes into a screen grid you draw yourself; note that embedding a fully faithful
  live terminal inside a Python TUI (e.g. Textual) is more work than a web + xterm.js view.
- **Optional server-side ANSI→grid normalization: `pyte`**, if you prefer to hand the
  frontend a clean grid + attributes rather than raw escapes.

Recommended default stack: **asyncssh** (transport) + **FastAPI/WebSocket** (local
backend) + **xterm.js** (render). Substitute the render layer freely; the transport and
tmux mechanics below do not change.

## 5. Server-side: tmux setup and required settings

### 5.1 Launch an agent session

Start the agent **detached**, in its project directory, at a fixed size:

```bash
tmux new-session -d -s agent1 -x 200 -y 50 \
  -c /path/to/project 'codex'      # or: claude
```

- `-d` detached (no client attaches).
- `-s agent1` stable session name = the handle the local app uses everywhere.
- `-x 200 -y 50` **fix the window size** (see 5.2 — this is critical).
- `-c <dir>` working directory.
- Final argument is the command to run in the pane.

### 5.2 Required settings (do these once per server, e.g. in `~/.tmux.conf`)

These are not optional — get them wrong and the mirrored screen is either the wrong size
or full of broken characters.

1. **Window sizing.** A detached session that no client ever attaches to defaults to
   **80×24**. The TUI renders to that size regardless of your UI. Pin the size:
   ```bash
   tmux set -g window-size manual        # do not auto-resize to attached clients
   # size is then whatever -x/-y you created with, or:
   tmux resize-window -t agent1 -x 200 -y 50
   ```
   Decide on a canonical viewport (e.g. 200×50), create every session at that size, and
   render the UI at the same dimensions. If you want the UI size to drive it, expose a
   "resize" action that calls `resize-window` and let the TUI reflow.

2. **Terminal type + color.** The agent TUIs use 256/true color and box-drawing glyphs:
   ```bash
   tmux set -g default-terminal "tmux-256color"
   tmux set -ga terminal-overrides ",*:Tc"   # enable truecolor passthrough
   ```

3. **UTF-8 locale** in the environment the agent runs under, or box-drawing/borders break:
   ```bash
   # ensure LANG / LC_ALL resolve to a UTF-8 locale for the launched process
   export LANG=C.UTF-8            # or a real *.UTF-8 locale installed on the box
   ```

### 5.3 tmux command reference (the full API surface used)

| Purpose | Command |
|---|---|
| Create agent session | `tmux new-session -d -s <name> -x <w> -y <h> -c <dir> '<cmd>'` |
| Capture current screen | `tmux capture-pane -t <name> -p -e` |
| List sessions + metadata | `tmux list-sessions -F '#{session_name}\t#{session_activity}\t#{pane_current_command}'` |
| Check a session is alive | `tmux has-session -t <name>` (exit 0 = exists) |
| Send text | `tmux send-keys -t <name> -l 'refactor the search module'` |
| Send Enter / keys | `tmux send-keys -t <name> Enter` (also `C-c`, `Escape`, `Up`, `Down`, `y`, `n`) |
| Resize | `tmux resize-window -t <name> -x <w> -y <h>` |
| Kill session | `tmux kill-session -t <name>` |
| Live output stream (opt.) | `tmux pipe-pane -t <name> -o 'cat >> /tmp/<name>.raw'` |
| Control-mode attach (opt.) | `tmux -CC attach-session -t <name>` |

**`capture-pane` notes (important):**
- `-p` prints to stdout (instead of an internal buffer); `-e` includes ANSI escape
  sequences so colors/attributes survive. Drop `-e` if you render plain text only.
- For a full-screen TUI (alternate-screen buffer), `capture-pane` returns the **current
  visible grid** — exactly "the window showing right now," which is what we want.
- **Scrollback does not apply.** Alternate-screen apps do not populate tmux history, so
  `-S -<n>` will not give you meaningful agent history. You get the live screen only. This
  is acceptable and expected for this feature.

## 6. Local-side: SSH transport

### 6.1 Persistent connection per server

Open one `asyncssh` connection per server at startup (or lazily on first use) and keep it
open. Never reconnect per poll — the handshake cost would dominate at 4 Hz.

```python
import asyncssh

async def open_conn(server):
    return await asyncssh.connect(
        host=server.host,
        port=server.port,
        client_keys=[server.key_path],      # public-key auth
        known_hosts=server.known_hosts,     # pin host keys in prod (see 14)
        keepalive_interval=15,              # detect dead links
        keepalive_count_max=3,
    )

async def tmux(conn, args: str):
    r = await conn.run(f"tmux {args}", check=False)
    return r.exit_status, r.stdout, r.stderr
```

Run tmux commands as non-PTY `conn.run(...)` calls — tmux commands do not need a TTY.
(Only the agent needs a PTY, and tmux already gave it one.)

### 6.2 Connection reuse and multiplexing

`asyncssh` runs each `conn.run` on its own channel over the single connection, so many
concurrent captures/inputs to the same server share one TCP/SSH session. If you ever shell
out to the system `ssh` binary instead, use `ControlMaster`/`ControlPersist` sockets to get
the same multiplexing.

### 6.3 Auth and host keys

- Auth is public-key only; point `client_keys` at the right private key per server (the
  server list already maps host → key).
- **Pin host keys.** Populate a `known_hosts` file and pass it to `known_hosts=`. Do not
  ship `known_hosts=None` (that disables verification) outside local testing.

## 7. Capturing state — two strategies

Implement **Strategy A** first; it satisfies the requirement. Strategy B is an optional
upgrade for smoother live updates.

### 7.1 Strategy A — poll `capture-pane` (recommended baseline)

For each session **currently visible in the UI**, run a poll loop that captures the screen
and pushes it to the frontend:

```python
async def poll_session(conn, name, push, interval=0.25):
    while watching(name):
        code, out, _ = await tmux(conn, f"capture-pane -t {name} -p -e")
        if code == 0:
            await push(name, out)     # send raw ANSI screen to the renderer
        else:
            await push_status(name, "dead")   # has-session will confirm
            return
        await asyncio.sleep(interval)
```

- **Poll only what's on screen.** Do not poll every session on every server continuously —
  that does not scale. Start a poll loop when the user opens a session; stop it when they
  navigate away. Provide a separate on-demand "snapshot" call for previews/thumbnails.
- **Rate:** 200–400 ms is a good balance for a live feel. Consider adaptive polling: slow
  to ~1 s when the screen hash is unchanged, speed up when it changes.
- **Change detection:** hash each capture; only push to the frontend when it differs, to
  cut bandwidth and re-renders.
- **Caveat:** snapshots can catch mid-animation frames (spinners). Acceptable for a live
  view; the next poll corrects it.

### 7.2 Strategy B — tmux control mode (event-driven, optional)

tmux **control mode** (`-CC`) is the closest thing to a real tmux API and is what
terminal apps (e.g. iTerm2) use to embed tmux. Instead of polling, you get pushed
notifications and stream output straight into a terminal emulator.

Open one long-lived control-mode channel per server over the persistent SSH connection:

```python
proc = await conn.create_process("tmux -CC attach -t agent1")
# read proc.stdout line-by-line; write commands to proc.stdin
```

- Notifications to parse include `%output %<pane> <data>` (raw pane bytes as they are
  produced), `%begin`/`%end`/`%error` (command results), `%window-add`, `%layout-change`,
  `%sessions-changed`, `%exit`.
- Feed the `%output` byte stream directly into `xterm.js` (or `pyte`) for a faithful,
  low-latency live mirror with no polling.
- Cost: you must implement the control protocol parser and reconcile the initial screen
  (do one `capture-pane -e` at attach time to seed state, then apply `%output` deltas).
- **Recommendation:** ship Strategy A first; move the "actively focused" session to
  Strategy B later if you want smoother updates. Both can coexist (poll for thumbnails,
  control mode for the focused pane).

### 7.3 `pipe-pane` (alternative live tap)

`tmux pipe-pane -t <name> -o 'cat >> /tmp/<name>.raw'` continuously copies the pane's raw
output to a file/command; tail it over SSH and replay into a terminal emulator. Simpler
than control mode but you must seed with a `capture-pane` snapshot first (you miss the
screen setup that happened before piping started). Use only if control mode is undesirable.

## 8. Rendering the captured screen

- **Raw ANSI → `xterm.js`:** capture with `-e`, write the snapshot to an `xterm.js`
  instance. For snapshot mode, reset/clear then write the full frame each update
  (`term.reset(); term.write(frame)`), or write with a home-cursor sequence. For
  control-mode/pipe-pane streams, write bytes as they arrive — no clearing.
- **ANSI → grid (Python):** feed captures into `pyte.Screen`/`pyte.Stream` to get a
  character grid with per-cell fg/bg/bold/etc., then render however the UI wants. Useful
  for a Python-native frontend or for producing HTML via a simple cell-to-span mapping.
- Keep the render viewport size equal to the tmux session size (see 5.2) so nothing wraps
  or truncates unexpectedly.

## 9. Sending input and handling prompts

All input goes through `send-keys`:

- **Type a prompt:** `send-keys -t <name> -l '<text>'` then `send-keys -t <name> Enter`.
  `-l` sends the text literally (no key-name interpretation) — required so text containing
  words like `Enter` or `C-c` is not misread as keys.
- **Control/navigation keys:** `send-keys -t <name> C-c` / `Escape` / `Up` / `Down` /
  `Left` / `Right` / `Space` / `Tab` / `BSpace`.
- **Approval prompts** (agent asks "run this command? [y/N]"): send `y`/`n` + `Enter`, or
  a bare key depending on the prompt. Detecting that a prompt is showing must be done by
  scanning the captured screen text for the agent's known prompt strings. **This is the
  fragile part** — prompt wording differs between `codex` and `claude` and can change
  across versions. Isolate it behind a per-agent adapter with the prompt markers in config,
  and default to surfacing the raw screen to the human rather than auto-answering.

## 10. Local async/process model

- Single asyncio loop. One `asyncssh` connection object per server, created at startup,
  auto-reconnect with backoff on drop (keepalive detects dead links).
- A **capture scheduler**: dict of active `(server, session)` → poll task (Strategy A) or
  control-mode reader task (Strategy B). Created/cancelled as the UI focuses/unfocuses.
- A **push channel** to the UI (WebSocket) per focused session carrying frames + status.
- An **input queue** per session; serialize `send-keys` so keystrokes stay ordered.
- Bound concurrency per server (e.g. cap simultaneous captures) to avoid hammering one box.

## 11. Data model

```
Server   { id, host, port, key_path, known_hosts, label }
Session  { server_id, tmux_name, agent_type("codex"|"claude"),
           project_dir, cols, rows, created_at, status }
Frame    { session_key, seq, captured_at, ansi_bytes }   # transient, not persisted
```

Session state can be reconstructed from the server at any time via `list-sessions`, so the
local store is a cache/index, not the source of truth. On startup, enumerate each server's
sessions and reconcile.

## 12. Lifecycle and liveness

- **Enumerate:** `list-sessions -F ...` per server → build/refresh the session list, using
  `#{pane_current_command}` to confirm the agent (vs. a shell that appeared after it
  exited) and `#{session_activity}` for last-activity display.
- **Liveness:** `has-session -t <name>` (exit code) or a failed `capture-pane` → mark dead.
- **Create/kill:** expose actions mapping to `new-session` / `kill-session`.
- **"Is it waiting for me?"** heuristic only: scan the latest capture for known prompt
  markers per agent; treat as a hint, never a guarantee.

## 13. Gotchas (must read before implementing)

1. **Detached sessions default to 80×24.** Always create with `-x/-y` and set
   `window-size manual`, or the mirror is the wrong size. (§5.2)
2. **No scrollback for TUIs.** Alternate-screen apps don't fill tmux history; `capture-pane`
   gives the live screen only. Don't build features assuming retrievable history. (§5.3)
3. **`TERM`, truecolor, and UTF-8 locale must be right** or you get broken borders and
   wrong colors. (§5.2)
4. **Use `-l` for literal text** in `send-keys`, or user text can be misinterpreted as key
   names. (§9)
5. **Do not open a fresh SSH connection per poll.** Reuse persistent connections. (§6.1)
6. **Poll only visible sessions.** Continuous polling of all sessions × all servers will
   not scale. (§7.1)
7. **Prompt detection is version-fragile.** Keep markers in per-agent config; prefer human
   confirmation over auto-answering. (§9)
8. **One-time agent login per server** is separate from SSH auth: `codex login --device-auth`
   or the `claude` paste-code flow, run once over SSH inside the box. Out of scope to
   automate here, but the session won't work until it's done.

## 14. Security

- Public-key auth only; store private keys with least privilege on the local machine.
- **Pin host keys** via `known_hosts`; never disable host verification outside local tests.
- The local backend (if it exposes a WebSocket/HTTP port) must bind to `localhost` only.
  Nothing here should be reachable from the public internet.
- `send-keys` can execute arbitrary things inside the agent session; treat the input path
  as privileged. Consider running agents on a non-privileged server user and inside a git
  worktree/branch so an over-eager agent's blast radius is contained.

## 15. Out of scope / assumptions

- No JSON/headless event ingestion (by design).
- One-time per-server agent authentication (`codex`/`claude` login) is assumed already
  done or handled separately.
- Assumes tmux ≥ 3.x on every server and that `codex`/`claude` are installed and on `PATH`
  for the launching user.

## 16. Acceptance criteria (definition of done)

1. App loads the server list and opens a persistent, host-key-verified SSH connection to
   each reachable server.
2. Can create a named agent session on any server at a fixed size running `codex` or
   `claude`, and it survives SSH disconnects.
3. Enumerates live sessions per server with agent type and last-activity.
4. Opening a session shows its **current tmux screen**, correctly sized, with colors and
   box-drawing intact, refreshing live (≤ ~400 ms) while focused.
5. Can send a typed prompt, `Enter`, and control keys (`C-c`, `Esc`, arrows, `y`/`n`) to a
   session and see the effect in the mirror.
6. Detects and reflects a dead/exited session.
7. Only focused/visible sessions are actively polled; idle sessions consume no steady poll
   traffic.
8. No connection is re-established per capture; captures for one server share one SSH
   connection.
