from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from repositories.missions import (
    create_mission,
    create_mission_step,
    delete_mission,
    delete_mission_step,
    list_missions,
    update_mission,
    update_mission_step,
)

router = APIRouter(prefix="/planning", tags=["missions"])


class MissionStepResponse(BaseModel):
    id: int
    title: str
    description: str | None
    is_next: bool
    position: int
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


class DeleteResponse(BaseModel):
    deleted: bool


def normalized_text(value: str) -> str:
    return value.strip()


def normalized_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.strip()
    return cleaned if cleaned else None


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
    return mission


@router.delete("/missions/{mission_id}", response_model=DeleteResponse)
async def delete_mission_route(mission_id: int, user: dict = Depends(require_authenticated_user)):
    deleted = await delete_mission(mission_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Mission not found")
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
    return mission


@router.delete("/mission-steps/{step_id}", response_model=DeleteResponse)
async def delete_mission_step_route(step_id: int, user: dict = Depends(require_authenticated_user)):
    deleted = await delete_mission_step(step_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Step not found")
    return {"deleted": True}
