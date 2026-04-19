from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from repositories.activity_events import (
    create_activity_event,
    delete_activity_event,
    delete_manual_activity_event,
    get_activity_event,
    list_activity_events,
    update_manual_activity_event,
)

router = APIRouter(prefix="/planning", tags=["activity"])


ActivityEventSource = Literal["manual", "tasks", "okrs", "glossary", "missions"]


class ActivityEventResponse(BaseModel):
    id: int
    user_id: int
    source: ActivityEventSource
    text: str
    metadata: dict[str, Any]
    occurred_at: datetime
    created_at: datetime
    updated_at: datetime


class ManualActivityEventCreateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    occurred_at: datetime | None = None


class ManualActivityEventUpdateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    occurred_at: datetime


class DeleteResponse(BaseModel):
    deleted: bool


def normalized_text(value: str) -> str:
    return value.strip()


@router.get("/activity-events", response_model=list[ActivityEventResponse])
async def get_activity_events(
    source: ActivityEventSource | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    user: dict = Depends(require_authenticated_user),
):
    return await list_activity_events(user_id=user["id"], source=source, limit=limit)


@router.post("/activity-events/manual", response_model=ActivityEventResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_activity_event(
    payload: ManualActivityEventCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    text = normalized_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Entry text is required.")

    event = await create_activity_event(
        user_id=user["id"],
        source="manual",
        text=text,
        metadata={},
        occurred_at=payload.occurred_at,
    )
    if event is None:
        raise HTTPException(status_code=500, detail="Failed to create activity event.")
    return event


@router.put("/activity-events/{event_id}/manual", response_model=ActivityEventResponse)
async def update_manual_activity_event_route(
    event_id: int,
    payload: ManualActivityEventUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    text = normalized_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Entry text is required.")

    existing_event = await get_activity_event(user["id"], event_id)
    if existing_event is None:
        raise HTTPException(status_code=404, detail="Activity event not found.")
    if existing_event["source"] != "manual":
        raise HTTPException(status_code=400, detail="Only manual events can be edited.")

    updated_event = await update_manual_activity_event(
        user_id=user["id"],
        event_id=event_id,
        text=text,
        occurred_at=payload.occurred_at,
    )
    if updated_event is None:
        raise HTTPException(status_code=404, detail="Manual activity event not found.")
    return updated_event


@router.delete("/activity-events/{event_id}/manual", response_model=DeleteResponse)
async def delete_manual_activity_event_route(
    event_id: int,
    user: dict = Depends(require_authenticated_user),
):
    existing_event = await get_activity_event(user["id"], event_id)
    if existing_event is None:
        raise HTTPException(status_code=404, detail="Activity event not found.")
    if existing_event["source"] != "manual":
        raise HTTPException(status_code=400, detail="Only manual events can be deleted.")

    deleted = await delete_manual_activity_event(user["id"], event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Manual activity event not found.")
    return {"deleted": True}


@router.delete("/activity-events/{event_id}", response_model=DeleteResponse)
async def delete_activity_event_route(
    event_id: int,
    user: dict = Depends(require_authenticated_user),
):
    existing_event = await get_activity_event(user["id"], event_id)
    if existing_event is None:
        raise HTTPException(status_code=404, detail="Activity event not found.")

    deleted = await delete_activity_event(user["id"], event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Activity event not found.")
    return {"deleted": True}
