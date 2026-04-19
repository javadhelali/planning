from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from api.dependencies.auth import require_authenticated_user
from core.activity_events import record_activity_event
from repositories.okrs import (
    adjust_key_result,
    archive_okr,
    create_key_result,
    create_okr,
    delete_key_result,
    delete_okr,
    get_key_result_context,
    get_okr,
    list_okrs,
    restore_okr,
    update_key_result,
    update_okr,
)

router = APIRouter(prefix="/planning", tags=["okrs"])


class KeyResultResponse(BaseModel):
    id: int
    title: str
    start_value: float
    current_value: float
    target_value: float
    step_value: float
    unit: str | None
    created_at: datetime
    updated_at: datetime


class OkrResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: str | None
    start_date: date
    end_date: date
    is_archived: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    key_results: list[KeyResultResponse]


class OkrBaseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date must be on or after start date.")
        return self


class OkrCreateRequest(OkrBaseRequest):
    pass


class OkrUpdateRequest(OkrBaseRequest):
    pass


class KeyResultBaseRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    start_value: float = Field(ge=0)
    current_value: float = Field(ge=0)
    target_value: float = Field(ge=0)
    step_value: float = Field(gt=0)
    unit: str | None = Field(default=None, max_length=24)

    @model_validator(mode="after")
    def validate_values(self):
        if self.start_value == self.target_value:
            raise ValueError("Start and target values must differ.")
        return self


class KeyResultCreateRequest(KeyResultBaseRequest):
    pass


class KeyResultUpdateRequest(KeyResultBaseRequest):
    pass


class KeyResultAdjustRequest(BaseModel):
    delta: float


class DeleteResponse(BaseModel):
    deleted: bool


@router.get("/okrs", response_model=list[OkrResponse])
async def get_okrs(user: dict = Depends(require_authenticated_user)):
    return await list_okrs(user["id"])


@router.post("/okrs", response_model=OkrResponse, status_code=status.HTTP_201_CREATED)
async def create_okr_route(
    payload: OkrCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    okr = await create_okr(
        user_id=user["id"],
        title=payload.title,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if okr is None:
        raise HTTPException(status_code=500, detail="Failed to create objective")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Created OKR "{okr["title"]}".',
        metadata={
            "event": "okr_created",
            "okr_id": okr["id"],
            "start_date": okr["start_date"].isoformat(),
            "end_date": okr["end_date"].isoformat(),
        },
        occurred_at=okr["created_at"],
    )
    return okr


@router.put("/okrs/{okr_id}", response_model=OkrResponse)
async def update_okr_route(
    okr_id: int,
    payload: OkrUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    okr = await update_okr(
        okr_id=okr_id,
        user_id=user["id"],
        title=payload.title,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if okr is None:
        raise HTTPException(status_code=404, detail="Objective not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Updated OKR "{okr["title"]}".',
        metadata={
            "event": "okr_updated",
            "okr_id": okr["id"],
            "start_date": okr["start_date"].isoformat(),
            "end_date": okr["end_date"].isoformat(),
        },
        occurred_at=okr["updated_at"],
    )
    return okr


@router.post("/okrs/{okr_id}/archive", response_model=OkrResponse)
async def archive_okr_route(okr_id: int, user: dict = Depends(require_authenticated_user)):
    okr = await archive_okr(okr_id, user["id"])
    if okr is None:
        raise HTTPException(status_code=404, detail="Objective not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Archived OKR "{okr["title"]}".',
        metadata={
            "event": "okr_archived",
            "okr_id": okr["id"],
        },
        occurred_at=okr["archived_at"] or okr["updated_at"],
    )
    return okr


@router.post("/okrs/{okr_id}/restore", response_model=OkrResponse)
async def restore_okr_route(okr_id: int, user: dict = Depends(require_authenticated_user)):
    okr = await restore_okr(okr_id, user["id"])
    if okr is None:
        raise HTTPException(status_code=404, detail="Objective not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Restored OKR "{okr["title"]}".',
        metadata={
            "event": "okr_restored",
            "okr_id": okr["id"],
        },
        occurred_at=okr["updated_at"],
    )
    return okr


@router.delete("/okrs/{okr_id}", response_model=DeleteResponse)
async def delete_okr_route(okr_id: int, user: dict = Depends(require_authenticated_user)):
    okr = await get_okr(user["id"], okr_id)
    if okr is None:
        raise HTTPException(status_code=404, detail="Objective not found")

    deleted = await delete_okr(okr_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Objective not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Deleted OKR "{okr["title"]}".',
        metadata={
            "event": "okr_deleted",
            "okr_id": okr["id"],
        },
    )
    return {"deleted": True}


@router.post("/okrs/{okr_id}/key-results", response_model=OkrResponse, status_code=status.HTTP_201_CREATED)
async def create_key_result_route(
    okr_id: int,
    payload: KeyResultCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    okr = await create_key_result(
        okr_id=okr_id,
        user_id=user["id"],
        title=payload.title,
        start_value=payload.start_value,
        current_value=payload.current_value,
        target_value=payload.target_value,
        step_value=payload.step_value,
        unit=payload.unit,
    )
    if okr is None:
        raise HTTPException(status_code=404, detail="Objective not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Added KR "{payload.title}" to OKR "{okr["title"]}".',
        metadata={
            "event": "okr_key_result_created",
            "okr_id": okr["id"],
            "key_result_title": payload.title,
            "start_value": payload.start_value,
            "current_value": payload.current_value,
            "target_value": payload.target_value,
            "step_value": payload.step_value,
            "unit": payload.unit,
        },
    )
    return okr


@router.put("/key-results/{key_result_id}", response_model=OkrResponse)
async def update_key_result_route(
    key_result_id: int,
    payload: KeyResultUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    okr = await update_key_result(
        key_result_id=key_result_id,
        user_id=user["id"],
        title=payload.title,
        start_value=payload.start_value,
        current_value=payload.current_value,
        target_value=payload.target_value,
        step_value=payload.step_value,
        unit=payload.unit,
    )
    if okr is None:
        raise HTTPException(status_code=404, detail="Key result not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Updated KR "{payload.title}" in OKR "{okr["title"]}".',
        metadata={
            "event": "okr_key_result_updated",
            "okr_id": okr["id"],
            "key_result_id": key_result_id,
            "key_result_title": payload.title,
            "start_value": payload.start_value,
            "current_value": payload.current_value,
            "target_value": payload.target_value,
            "step_value": payload.step_value,
            "unit": payload.unit,
        },
    )
    return okr


@router.patch("/key-results/{key_result_id}/adjust", response_model=OkrResponse)
async def adjust_key_result_route(
    key_result_id: int,
    payload: KeyResultAdjustRequest,
    user: dict = Depends(require_authenticated_user),
):
    okr = await adjust_key_result(key_result_id, user["id"], payload.delta)
    if okr is None:
        raise HTTPException(status_code=404, detail="Key result not found")
    adjusted_key_result = next((key_result for key_result in okr["key_results"] if key_result["id"] == key_result_id), None)
    if adjusted_key_result is not None:
        await record_activity_event(
            user_id=user["id"],
            source="okrs",
            text=f'Updated KR "{adjusted_key_result["title"]}" in OKR "{okr["title"]}" to {adjusted_key_result["current_value"]}.',
            metadata={
                "event": "okr_key_result_adjusted",
                "okr_id": okr["id"],
                "key_result_id": key_result_id,
                "key_result_title": adjusted_key_result["title"],
                "delta": payload.delta,
                "new_current_value": adjusted_key_result["current_value"],
                "unit": adjusted_key_result["unit"],
            },
            occurred_at=adjusted_key_result["updated_at"],
        )
    return okr


@router.delete("/key-results/{key_result_id}", response_model=DeleteResponse)
async def delete_key_result_route(key_result_id: int, user: dict = Depends(require_authenticated_user)):
    key_result_context = await get_key_result_context(user["id"], key_result_id)
    if key_result_context is None:
        raise HTTPException(status_code=404, detail="Key result not found")

    deleted = await delete_key_result(key_result_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Key result not found")
    await record_activity_event(
        user_id=user["id"],
        source="okrs",
        text=f'Deleted KR "{key_result_context["key_result_title"]}" from OKR "{key_result_context["okr_title"]}".',
        metadata={
            "event": "okr_key_result_deleted",
            "okr_id": key_result_context["okr_id"],
            "key_result_id": key_result_context["key_result_id"],
            "key_result_title": key_result_context["key_result_title"],
        },
    )
    return {"deleted": True}
