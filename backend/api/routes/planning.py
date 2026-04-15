from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from repositories.tasks import (
    clear_completed_tasks,
    create_task,
    delete_task,
    get_focused_task,
    list_tasks,
    update_task,
)

router = APIRouter(prefix="/planning", tags=["planning"])


TaskStatus = Literal["todo", "done"]


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    status: TaskStatus = "todo"
    due_date: date | None = None
    is_focused: bool = False
    is_important: bool = False
    is_urgent: bool = False


class TaskUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    status: TaskStatus
    due_date: date | None = None
    is_focused: bool
    is_important: bool = False
    is_urgent: bool = False


class TaskResponse(BaseModel):
    id: int
    user_id: int
    title: str
    notes: str | None
    status: TaskStatus
    due_date: date | None
    completed_at: datetime | None
    is_focused: bool
    is_important: bool
    is_urgent: bool
    created_at: datetime
    updated_at: datetime


class DeleteTaskResponse(BaseModel):
    deleted: bool


class ClearCompletedResponse(BaseModel):
    deleted_count: int


def resolved_completed_at(status_value: TaskStatus) -> datetime | None:
    if status_value == "done":
        return datetime.now(timezone.utc)
    return None


def resolved_is_focused(status_value: TaskStatus, is_focused: bool) -> bool:
    if status_value == "done":
        return False
    return is_focused


@router.get("/tasks", response_model=list[TaskResponse])
async def get_tasks(
    status_filter: TaskStatus | None = Query(default=None, alias="status"),
    user: dict = Depends(require_authenticated_user),
):
    return await list_tasks(user["id"], status_filter)


@router.get("/tasks/focused", response_model=TaskResponse | None)
async def get_focused_task_route(user: dict = Depends(require_authenticated_user)):
    return await get_focused_task(user["id"])


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task_route(
    payload: TaskCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    task = await create_task(
        user_id=user["id"],
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        due_date=payload.due_date,
        completed_at=resolved_completed_at(payload.status),
        is_focused=resolved_is_focused(payload.status, payload.is_focused),
        is_important=payload.is_important,
        is_urgent=payload.is_urgent,
    )
    if task is None:
        raise HTTPException(status_code=500, detail="Failed to create task")
    return task


@router.delete("/tasks/completed", response_model=ClearCompletedResponse)
async def clear_completed_tasks_route(user: dict = Depends(require_authenticated_user)):
    deleted_count = await clear_completed_tasks(user["id"])
    return {"deleted_count": deleted_count}


@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task_route(
    task_id: int,
    payload: TaskUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    task = await update_task(
        task_id=task_id,
        user_id=user["id"],
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        due_date=payload.due_date,
        completed_at=resolved_completed_at(payload.status),
        is_focused=resolved_is_focused(payload.status, payload.is_focused),
        is_important=payload.is_important,
        is_urgent=payload.is_urgent,
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/tasks/{task_id}", response_model=DeleteTaskResponse)
async def delete_task_route(task_id: int, user: dict = Depends(require_authenticated_user)):
    deleted = await delete_task(task_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"deleted": True}
