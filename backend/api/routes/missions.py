from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from core.activity_events import record_activity_event
from repositories.missions import (
    create_mission,
    create_mission_log_entry,
    create_mission_step,
    delete_mission_log_entry,
    delete_mission,
    delete_mission_step,
    get_mission,
    get_mission_log_entry,
    get_mission_step,
    list_mission_log_entries,
    list_missions,
    update_mission_log_entry,
    update_mission,
    update_mission_step,
)

router = APIRouter(prefix="/planning", tags=["missions"])

MissionLogEntryType = Literal["observation", "event", "decision", "hypothesis", "risk", "lesson"]
MissionLogImportance = Literal["low", "medium", "high"]
MissionLogSource = Literal["manual", "imported", "ai_generated"]


class MissionStepResponse(BaseModel):
    id: int
    title: str
    description: str | None
    is_next: bool
    position: int
    created_at: datetime
    updated_at: datetime


class MissionLogEntryResponse(BaseModel):
    id: int
    mission_id: int
    author_id: int
    text: str
    entry_type: MissionLogEntryType
    importance: MissionLogImportance
    tags: list[str]
    happened_at: datetime | None
    source: MissionLogSource
    created_at: datetime
    updated_at: datetime


class MissionResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: str | None
    position: int
    created_at: datetime
    updated_at: datetime
    steps: list[MissionStepResponse]
    log_entries: list[MissionLogEntryResponse]


class MissionCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)


class MissionUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    position: int = Field(ge=1)


class MissionStepCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    is_next: bool = False


class MissionStepUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    is_next: bool = False
    position: int = Field(ge=1)


class MissionLogEntryCreateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    entry_type: MissionLogEntryType = "observation"
    importance: MissionLogImportance = "medium"
    tags: list[str] = Field(default_factory=list)
    happened_at: datetime | None = None
    source: MissionLogSource = "manual"


class MissionLogEntryUpdateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    entry_type: MissionLogEntryType = "observation"
    importance: MissionLogImportance = "medium"
    tags: list[str] = Field(default_factory=list)
    happened_at: datetime | None = None


class DeleteResponse(BaseModel):
    deleted: bool


def normalized_text(value: str) -> str:
    return value.strip()


def normalized_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.strip()
    return cleaned if cleaned else None


def normalized_tags(tags: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()

    for raw_tag in tags:
        cleaned = raw_tag.strip().lower()
        if not cleaned:
            continue
        if len(cleaned) > 40:
            raise HTTPException(status_code=400, detail="Each tag must be 40 characters or less.")
        if cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)

    if len(deduped) > 20:
        raise HTTPException(status_code=400, detail="At most 20 tags are allowed.")

    return deduped


@router.get("/missions", response_model=list[MissionResponse])
async def get_missions(user: dict = Depends(require_authenticated_user)):
    return await list_missions(user["id"])


@router.post("/missions", response_model=MissionResponse, status_code=status.HTTP_201_CREATED)
async def create_mission_route(
    payload: MissionCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    title = normalized_text(payload.title)
    description = normalized_optional_text(payload.description)

    if not title:
        raise HTTPException(status_code=400, detail="Mission title is required.")

    mission = await create_mission(user["id"], title, description)
    if mission is None:
        raise HTTPException(status_code=500, detail="Failed to create mission")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=f'Created mission "{mission["title"]}".',
        metadata={
            "event": "mission_created",
            "mission_id": mission["id"],
            "position": mission["position"],
        },
        occurred_at=mission["created_at"],
    )
    return mission


@router.put("/missions/{mission_id}", response_model=MissionResponse)
async def update_mission_route(
    mission_id: int,
    payload: MissionUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    title = normalized_text(payload.title)
    description = normalized_optional_text(payload.description)

    if not title:
        raise HTTPException(status_code=400, detail="Mission title is required.")

    mission = await update_mission(
        mission_id=mission_id,
        user_id=user["id"],
        title=title,
        description=description,
        position=payload.position,
    )
    if mission is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=f'Updated mission "{mission["title"]}".',
        metadata={
            "event": "mission_updated",
            "mission_id": mission["id"],
            "position": mission["position"],
        },
        occurred_at=mission["updated_at"],
    )
    return mission


@router.delete("/missions/{mission_id}", response_model=DeleteResponse)
async def delete_mission_route(mission_id: int, user: dict = Depends(require_authenticated_user)):
    mission = await get_mission(user["id"], mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="Mission not found")

    deleted = await delete_mission(mission_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Mission not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=f'Deleted mission "{mission["title"]}".',
        metadata={
            "event": "mission_deleted",
            "mission_id": mission["id"],
        },
    )
    return {"deleted": True}


@router.post("/missions/{mission_id}/steps", response_model=MissionResponse, status_code=status.HTTP_201_CREATED)
async def create_mission_step_route(
    mission_id: int,
    payload: MissionStepCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    title = normalized_text(payload.title)
    description = normalized_optional_text(payload.description)

    if not title:
        raise HTTPException(status_code=400, detail="Step title is required.")

    mission = await create_mission_step(
        mission_id=mission_id,
        user_id=user["id"],
        title=title,
        description=description,
        is_next=payload.is_next,
    )
    if mission is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=f'Added step "{title}" in mission "{mission["title"]}".',
        metadata={
            "event": "mission_step_created",
            "mission_id": mission["id"],
            "step_title": title,
            "is_next": payload.is_next,
        },
    )
    return mission


@router.put("/mission-steps/{step_id}", response_model=MissionResponse)
async def update_mission_step_route(
    step_id: int,
    payload: MissionStepUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    title = normalized_text(payload.title)
    description = normalized_optional_text(payload.description)

    if not title:
        raise HTTPException(status_code=400, detail="Step title is required.")

    previous_step = await get_mission_step(step_id, user["id"])
    if previous_step is None:
        raise HTTPException(status_code=404, detail="Step not found")

    mission = await update_mission_step(
        step_id=step_id,
        user_id=user["id"],
        title=title,
        description=description,
        is_next=payload.is_next,
        position=payload.position,
    )
    if mission is None:
        raise HTTPException(status_code=404, detail="Step not found")

    event_key = "mission_step_updated"
    text = f'Updated step "{title}" in mission "{mission["title"]}".'
    if payload.is_next and not previous_step["is_next"]:
        event_key = "mission_step_marked_next"
        text = f'Set step "{title}" as the next step in mission "{mission["title"]}".'
    elif previous_step["is_next"] and not payload.is_next:
        event_key = "mission_step_unmarked_next"
        text = f'Removed next-step mark from "{title}" in mission "{mission["title"]}".'

    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=text,
        metadata={
            "event": event_key,
            "step_id": step_id,
            "mission_id": mission["id"],
            "step_title": title,
            "is_next": payload.is_next,
            "previous_is_next": previous_step["is_next"],
            "position": payload.position,
            "previous_position": previous_step["position"],
        },
    )
    return mission


@router.delete("/mission-steps/{step_id}", response_model=DeleteResponse)
async def delete_mission_step_route(step_id: int, user: dict = Depends(require_authenticated_user)):
    step = await get_mission_step(step_id, user["id"])
    if step is None:
        raise HTTPException(status_code=404, detail="Step not found")

    deleted = await delete_mission_step(step_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Step not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text=f'Deleted step "{step["title"]}".',
        metadata={
            "event": "mission_step_deleted",
            "step_id": step["id"],
            "mission_id": step["mission_id"],
        },
    )
    return {"deleted": True}


@router.get("/missions/{mission_id}/log-entries", response_model=list[MissionLogEntryResponse])
async def get_mission_log_entries_route(mission_id: int, user: dict = Depends(require_authenticated_user)):
    log_entries = await list_mission_log_entries(mission_id, user["id"])
    if log_entries is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    return log_entries


@router.post("/missions/{mission_id}/log-entries", response_model=MissionLogEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_mission_log_entry_route(
    mission_id: int,
    payload: MissionLogEntryCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    text = normalized_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Mission log entry text is required.")

    log_entry = await create_mission_log_entry(
        mission_id=mission_id,
        user_id=user["id"],
        author_id=user["id"],
        text=text,
        entry_type=payload.entry_type,
        importance=payload.importance,
        tags=normalized_tags(payload.tags),
        happened_at=payload.happened_at,
        source=payload.source,
    )
    if log_entry is None:
        raise HTTPException(status_code=404, detail="Mission not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text="Added a mission log entry.",
        metadata={
            "event": "mission_log_entry_created",
            "entry_id": log_entry["id"],
            "mission_id": log_entry["mission_id"],
            "entry_type": log_entry["entry_type"],
            "importance": log_entry["importance"],
            "source": log_entry["source"],
        },
        occurred_at=log_entry["happened_at"] or log_entry["created_at"],
    )
    return log_entry


@router.put("/mission-log-entries/{entry_id}", response_model=MissionLogEntryResponse)
async def update_mission_log_entry_route(
    entry_id: int,
    payload: MissionLogEntryUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    text = normalized_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Mission log entry text is required.")

    log_entry = await update_mission_log_entry(
        entry_id=entry_id,
        user_id=user["id"],
        text=text,
        entry_type=payload.entry_type,
        importance=payload.importance,
        tags=normalized_tags(payload.tags),
        happened_at=payload.happened_at,
    )
    if log_entry is None:
        raise HTTPException(status_code=404, detail="Mission log entry not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text="Updated a mission log entry.",
        metadata={
            "event": "mission_log_entry_updated",
            "entry_id": log_entry["id"],
            "mission_id": log_entry["mission_id"],
            "entry_type": log_entry["entry_type"],
            "importance": log_entry["importance"],
        },
        occurred_at=log_entry["happened_at"] or log_entry["updated_at"],
    )
    return log_entry


@router.delete("/mission-log-entries/{entry_id}", response_model=DeleteResponse)
async def delete_mission_log_entry_route(entry_id: int, user: dict = Depends(require_authenticated_user)):
    log_entry = await get_mission_log_entry(entry_id, user["id"])
    if log_entry is None:
        raise HTTPException(status_code=404, detail="Mission log entry not found")

    deleted = await delete_mission_log_entry(entry_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Mission log entry not found")
    await record_activity_event(
        user_id=user["id"],
        source="missions",
        text="Deleted a mission log entry.",
        metadata={
            "event": "mission_log_entry_deleted",
            "entry_id": log_entry["id"],
            "mission_id": log_entry["mission_id"],
            "entry_type": log_entry["entry_type"],
            "importance": log_entry["importance"],
        },
    )
    return {"deleted": True}
