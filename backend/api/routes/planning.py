from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from repositories.tasks import (
    clear_completed_tasks,
    create_task,
    delete_task,
    list_tasks,
    update_task,
)

router = APIRouter(prefix="/planning", tags=["planning"])


TaskStatus = Literal["todo", "in_progress", "done"]


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    status: TaskStatus = "todo"
    due_date: date | None = None


class TaskUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    status: TaskStatus
    due_date: date | None = None


class TaskResponse(BaseModel):
    id: int
    title: str
    notes: str | None
    status: TaskStatus
    due_date: date | None
    completed_at: datetime | None
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


@router.get("/tasks", response_model=list[TaskResponse])
async def get_tasks(status_filter: TaskStatus | None = Query(default=None, alias="status")):
    return await list_tasks(status_filter)


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task_route(payload: TaskCreateRequest):
    task = await create_task(
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        due_date=payload.due_date,
        completed_at=resolved_completed_at(payload.status),
    )
    if task is None:
        raise HTTPException(status_code=500, detail="Failed to create task")
    return task


@router.delete("/tasks/completed", response_model=ClearCompletedResponse)
async def clear_completed_tasks_route():
    deleted_count = await clear_completed_tasks()
    return {"deleted_count": deleted_count}


@router.put("/tasks/{task_id}", response_model=TaskResponse)
async def update_task_route(task_id: int, payload: TaskUpdateRequest):
    task = await update_task(
        task_id=task_id,
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        due_date=payload.due_date,
        completed_at=resolved_completed_at(payload.status),
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/tasks/{task_id}", response_model=DeleteTaskResponse)
async def delete_task_route(task_id: int):
    deleted = await delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"deleted": True}
