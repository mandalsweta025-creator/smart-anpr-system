"""
websocket_service.py
====================
Sync-to-async bridge for broadcasting WebSocket events from background threads.
The event loop reference is stored at startup so threads can schedule coroutines.
"""

import asyncio
import logging

from backend.app.infrastructure.websocket_manager import manager

logger = logging.getLogger(__name__)

_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called once at startup from the async lifespan context."""
    global _loop
    _loop = loop


def broadcast_detection_event(payload: dict) -> None:
    """
    Schedule a WebSocket broadcast from any thread (sync or async).
    Safe to call from daemon threads — uses call_soon_threadsafe.
    """
    if "type" not in payload:
        payload = {"type": "detection", **payload}

    global _loop

    # Lazily capture the loop if set_event_loop wasn't called yet
    if _loop is None:
        try:
            _loop = asyncio.get_event_loop()
        except RuntimeError:
            logger.warning("broadcast_detection_event: no event loop available, event dropped")
            return

    try:
        _loop.call_soon_threadsafe(
            lambda p=payload: asyncio.ensure_future(manager.broadcast(p))
        )
    except Exception as e:
        logger.warning(f"broadcast_detection_event failed: {e}")


__all__ = ["manager", "broadcast_detection_event", "set_event_loop"]
