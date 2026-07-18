from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from repositories.projects import (
    create_project,
    delete_project,
    get_project,
    list_projects,
    update_project,
)
from repositories.servers import (
    create_server,
    delete_server,
    get_server,
    list_servers,
    update_server,
)

router = APIRouter(prefix="/planning", tags=["projects"])


ProjectKind = Literal["personal", "startup", "mvp", "test"]


class ServerResponse(BaseModel):
    id: int
    user_id: int
    name: str
    host: str
    port: int
    username: str | None
    key_path: str | None
    position: int
    created_at: datetime
    updated_at: datetime


class ServerCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=255)
    key_path: str | None = Field(default=None, max_length=1024)


class ServerUpdateRequest(ServerCreateRequest):
    position: int = Field(default=1, ge=1)


class ProjectResponse(BaseModel):
    id: int
    user_id: int
    server_id: int | None
    name: str
    slug: str
    description: str | None
    kind: ProjectKind
    root_path: str | None
    position: int
    created_at: datetime
    updated_at: datetime
    server_name: str | None
    server_host: str | None


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    server_id: int | None = None
    description: str | None = Field(default=None, max_length=1000)
    kind: ProjectKind = "personal"
    root_path: str | None = Field(default=None, max_length=1024)


class ProjectUpdateRequest(ProjectCreateRequest):
    position: int = Field(default=1, ge=1)


class DeleteResponse(BaseModel):
    deleted: bool


def normalized_text(value: str) -> str:
    return value.strip()


def normalized_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned if cleaned else None


# ---- Servers ----------------------------------------------------------------


@router.get("/servers", response_model=list[ServerResponse])
async def get_servers(user: dict = Depends(require_authenticated_user)):
    return await list_servers(user["id"])


@router.post("/servers", response_model=ServerResponse, status_code=status.HTTP_201_CREATED)
async def create_server_route(
    payload: ServerCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    host = normalized_text(payload.host)
    if not name:
        raise HTTPException(status_code=400, detail="Server name is required.")
    if not host:
        raise HTTPException(status_code=400, detail="Server host is required.")

    server = await create_server(
        user_id=user["id"],
        name=name,
        host=host,
        port=payload.port,
        username=normalized_optional_text(payload.username),
        key_path=normalized_optional_text(payload.key_path),
    )
    if server is None:
        raise HTTPException(status_code=500, detail="Failed to create server")
    return server


@router.put("/servers/{server_id}", response_model=ServerResponse)
async def update_server_route(
    server_id: int,
    payload: ServerUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    host = normalized_text(payload.host)
    if not name:
        raise HTTPException(status_code=400, detail="Server name is required.")
    if not host:
        raise HTTPException(status_code=400, detail="Server host is required.")

    server = await update_server(
        server_id=server_id,
        user_id=user["id"],
        name=name,
        host=host,
        port=payload.port,
        username=normalized_optional_text(payload.username),
        key_path=normalized_optional_text(payload.key_path),
        position=payload.position,
    )
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.delete("/servers/{server_id}", response_model=DeleteResponse)
async def delete_server_route(server_id: int, user: dict = Depends(require_authenticated_user)):
    server = await get_server(server_id, user["id"])
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")

    deleted = await delete_server(server_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"deleted": True}


# ---- Projects ---------------------------------------------------------------


@router.get("/projects", response_model=list[ProjectResponse])
async def get_projects(user: dict = Depends(require_authenticated_user)):
    return await list_projects(user["id"])


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project_route(project_id: int, user: dict = Depends(require_authenticated_user)):
    project = await get_project(project_id, user["id"])
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project_route(
    payload: ProjectCreateRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    project = await create_project(
        user_id=user["id"],
        server_id=payload.server_id,
        name=name,
        description=normalized_optional_text(payload.description),
        kind=payload.kind,
        root_path=normalized_optional_text(payload.root_path),
    )
    if project is None:
        raise HTTPException(status_code=400, detail="Selected server not found")
    return project


@router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project_route(
    project_id: int,
    payload: ProjectUpdateRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")

    existing = await get_project(project_id, user["id"])
    if existing is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project = await update_project(
        project_id=project_id,
        user_id=user["id"],
        server_id=payload.server_id,
        name=name,
        description=normalized_optional_text(payload.description),
        kind=payload.kind,
        root_path=normalized_optional_text(payload.root_path),
        position=payload.position,
    )
    if project is None:
        raise HTTPException(status_code=400, detail="Selected server not found")
    return project


@router.delete("/projects/{project_id}", response_model=DeleteResponse)
async def delete_project_route(project_id: int, user: dict = Depends(require_authenticated_user)):
    project = await get_project(project_id, user["id"])
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    deleted = await delete_project(project_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True}
