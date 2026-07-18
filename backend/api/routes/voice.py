"""Live speech-to-text, proxied through the backend to Soniox.

The browser streams microphone audio to this WebSocket; we relay it to Soniox's
real-time API and relay the transcript back. The Soniox API key stays on the
server and never reaches the browser.

Soniox tags each token with `translation_status`, so one stream carries both the
original speech and its translation — speak Persian and the client can show the
English rendering live while you talk.

The outbound leg honours the configured SOCKS/HTTP proxy, so this works from
networks that can't reach Soniox directly.
"""

import asyncio
import contextlib
import json
import logging

import websockets
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from websockets.asyncio.client import connect

from config import settings
from core.auth import get_user_by_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/planning", tags=["voice"])

SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket"

# Close codes the client can tell apart.
_UNAUTHORIZED = 4401
_NOT_CONFIGURED = 4402
_UPSTREAM_FAILED = 4500

# How long to keep draining Soniox after the client stops sending audio.
_DRAIN_SECONDS = 20.0


def _proxy() -> str | None:
    """Proxy for the outbound Soniox connection, or None to dial directly.

    `soniox_proxy` wins over the shared `global_access_http_proxy`; setting it to
    "direct" opts Soniox out of the global proxy. SOCKS URLs need python-socks;
    http/https proxies are tunnelled with CONNECT.
    """
    configured = (settings.soniox_proxy or "").strip()
    if configured.lower() == "direct":
        return None
    return configured or (settings.global_access_http_proxy or "").strip() or None


def _build_config(language_hints: list[str], target_language: str) -> dict:
    """The Soniox session config. `audio_format: auto` accepts the browser's
    MediaRecorder container (webm/opus, or mp4 on Safari) as-is."""
    config: dict = {
        "api_key": settings.soniox_api_key,
        "model": settings.soniox_model,
        "audio_format": "auto",
        "language_hints": language_hints,
        "enable_language_identification": True,
        "enable_endpoint_detection": True,
    }
    if target_language:
        # One-way: whatever is spoken gets rendered into `target_language`.
        config["translation"] = {"type": "one_way", "target_language": target_language}
    return config


async def _pump_audio(client: WebSocket, soniox) -> bool:
    """Browser audio chunks → Soniox.

    Returns True when the client said it was done speaking (so the tail of the
    transcript is still worth waiting for), and False when it simply went away —
    in which case there is nobody left to deliver that tail to.
    """
    try:
        while True:
            message = await client.receive()
            if message["type"] == "websocket.disconnect":
                return False
            chunk = message.get("bytes")
            if chunk:
                await soniox.send(chunk)
                continue
            # An empty text frame is our "done speaking" signal.
            if (message.get("text") or "").strip() in ("", "end"):
                return True
    except (WebSocketDisconnect, RuntimeError):
        return False


async def _pump_transcript(client: WebSocket, soniox) -> None:
    """Soniox responses → browser, verbatim, until either end hangs up.

    The browser can close its socket at any moment (it does so as soon as it sees
    `finished`, and on unmount). Writing after that raises from the ASGI layer, so
    check before each send and give up quietly if it has gone.
    """
    async for raw in soniox:
        if client.application_state != WebSocketState.CONNECTED:
            return
        text = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
        try:
            await client.send_text(text)
        except RuntimeError:
            # Closed between the check and the send — nothing left to deliver.
            return


@router.websocket("/voice/stream")
async def voice_stream(
    websocket: WebSocket,
    token: str = Query(default=""),
    target_language: str = Query(default="en"),
    language_hints: str = Query(default="fa,en"),
):
    """Stream microphone audio up, transcript (and translation) tokens down.

    The session token rides in the query string because browsers cannot set
    headers on a WebSocket handshake.
    """
    await websocket.accept()

    user = await get_user_by_session(token.strip()) if token.strip() else None
    if user is None:
        await websocket.close(code=_UNAUTHORIZED, reason="Unauthorized")
        return

    if not settings.soniox_api_key:
        await websocket.close(code=_NOT_CONFIGURED, reason="Soniox API key is not configured")
        return

    hints = [hint.strip() for hint in language_hints.split(",") if hint.strip()]
    config = _build_config(hints, target_language.strip())

    proxy = _proxy()
    try:
        # proxy=None dials directly; a URL routes the connection through it.
        soniox = await connect(SONIOX_WS_URL, max_size=None, proxy=proxy)
    except ImportError:
        # A socks:// proxy without python-socks installed.
        logger.exception("SOCKS proxy configured but python-socks is missing")
        await websocket.close(code=_NOT_CONFIGURED, reason="SOCKS proxy support is not installed")
        return
    except (OSError, websockets.exceptions.WebSocketException) as exc:
        logger.warning("Soniox connect failed (proxy=%s): %s", proxy or "direct", exc)
        await websocket.close(code=_UPSTREAM_FAILED, reason="Could not reach Soniox")
        return

    async with soniox:
        await soniox.send(json.dumps(config))

        audio = asyncio.create_task(_pump_audio(websocket, soniox))
        transcript = asyncio.create_task(_pump_transcript(websocket, soniox))
        try:
            await asyncio.wait({audio, transcript}, return_when=asyncio.FIRST_COMPLETED)

            # Only wait for the tail if the client is still there to receive it.
            # If it hung up, draining would relay into a closed socket.
            finished_speaking = (
                audio.done()
                and not audio.cancelled()
                and audio.exception() is None
                and audio.result()
            )
            if finished_speaking and not transcript.done():
                with contextlib.suppress(websockets.exceptions.WebSocketException):
                    await soniox.send("")
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(asyncio.shield(transcript), timeout=_DRAIN_SECONDS)
        except (WebSocketDisconnect, websockets.exceptions.WebSocketException) as exc:
            logger.info("Voice stream ended: %s", exc)
        finally:
            for task in (audio, transcript):
                task.cancel()
            await asyncio.gather(audio, transcript, return_exceptions=True)

    # The client may well have closed first; closing twice is an error.
    if websocket.application_state == WebSocketState.CONNECTED:
        with contextlib.suppress(RuntimeError):
            await websocket.close()
