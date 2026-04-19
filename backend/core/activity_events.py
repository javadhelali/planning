from datetime import datetime
from typing import Literal

from repositories.activity_events import create_activity_event, ensure_activity_events_schema


ActivityEventSource = Literal["manual", "tasks", "okrs", "glossary", "missions"]


async def bootstrap_activity_events() -> None:
    try:
        await ensure_activity_events_schema()
    except Exception:
        # Logging failures must never block application startup.
        return


async def record_activity_event(
    user_id: int,
    source: ActivityEventSource,
    text: str,
    metadata: dict | None = None,
    occurred_at: datetime | None = None,
) -> None:
    cleaned_text = text.strip()
    if not cleaned_text:
        return

    await create_activity_event(
        user_id=user_id,
        source=source,
        text=cleaned_text,
        metadata=metadata or {},
        occurred_at=occurred_at,
    )
