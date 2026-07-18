"""Read-only overviews for a server or a project, gathered over SSH.

Server overview: running services, the user's cronjobs, and disk usage.
Project overview: the repo's AGENTS.md (if present) and its changed files
(if the project root is a git work tree). Everything is fetched in a single
SSH round-trip per resource, then parsed here in the route layer.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.dependencies.auth import require_authenticated_user
from external import ssh
from repositories.projects import get_project
from repositories.servers import get_server

router = APIRouter(prefix="/planning", tags=["overview"])


# --- schemas -----------------------------------------------------------------


class ServiceInfo(BaseModel):
    name: str
    state: str = ""
    description: str = ""
    scope: str = "system"  # "system" or "user"


class DiskInfo(BaseModel):
    filesystem: str
    size: str
    used: str
    avail: str
    use_percent: str
    mounted_on: str


class ServerOverviewResponse(BaseModel):
    ok: bool
    error: str | None = None
    services: list[ServiceInfo] = []
    cronjobs: list[str] = []
    disk: list[DiskInfo] = []


class ChangedFile(BaseModel):
    status: str
    path: str


class ProjectOverviewResponse(BaseModel):
    ok: bool
    error: str | None = None
    has_root: bool = False
    is_git: bool = False
    agents_md: str | None = None
    changed_files: list[ChangedFile] = []


# --- helpers -----------------------------------------------------------------

# Disk filesystems that are just memory/pseudo mounts — noise for an overview.
_HIDDEN_FS = {"tmpfs", "devtmpfs", "efivarfs", "udev", "none"}


async def _require_server(server_id: int, user: dict) -> dict:
    server = await get_server(server_id, user["id"])
    if server is None:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


def _split_sections(text: str, markers: list[str]) -> dict[str, list[str]]:
    """Bucket output lines by the `===MARKER===` echo that precedes each block."""
    sections: dict[str, list[str]] = {marker: [] for marker in markers}
    current: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped in sections:
            current = stripped
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def _parse_services(lines: list[str], scope: str) -> list[ServiceInfo]:
    services: list[ServiceInfo] = []
    for line in lines:
        parts = line.split(maxsplit=4)
        if len(parts) < 4 or not parts[0].endswith(".service"):
            continue
        services.append(
            ServiceInfo(
                name=parts[0].removesuffix(".service"),
                state=parts[3],
                description=parts[4] if len(parts) > 4 else "",
                scope=scope,
            )
        )
    return services


def _parse_cron(lines: list[str]) -> list[str]:
    jobs: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        jobs.append(stripped)
    return jobs


def _parse_disk(lines: list[str]) -> list[DiskInfo]:
    disks: list[DiskInfo] = []
    for line in lines:
        parts = line.split(maxsplit=5)
        if len(parts) < 6 or parts[0] == "Filesystem":
            continue
        if parts[0] in _HIDDEN_FS:
            continue
        disks.append(
            DiskInfo(
                filesystem=parts[0],
                size=parts[1],
                used=parts[2],
                avail=parts[3],
                use_percent=parts[4],
                mounted_on=parts[5],
            )
        )
    return disks


def _parse_status(lines: list[str]) -> list[ChangedFile]:
    files: list[ChangedFile] = []
    for line in lines:
        if len(line) < 4:
            continue
        # Porcelain v1: two status chars, a space, then the path.
        files.append(ChangedFile(status=line[:2].strip() or "?", path=line[3:].strip()))
    return files


# --- routes ------------------------------------------------------------------


@router.get("/servers/{server_id}/overview", response_model=ServerOverviewResponse)
async def server_overview(server_id: int, user: dict = Depends(require_authenticated_user)):
    server = await _require_server(server_id, user)
    services_cmd = "list-units --type=service --state=running --no-legend --plain --no-pager"
    command = (
        f'echo "===SERVICES==="; systemctl {services_cmd} 2>/dev/null; '
        f'echo "===USERSERVICES==="; systemctl --user {services_cmd} 2>/dev/null; '
        'echo "===CRON==="; crontab -l 2>/dev/null; '
        'echo "===DISK==="; df -hP 2>/dev/null'
    )
    result = await ssh.run_command(server, command)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    sections = _split_sections(
        result.get("stdout") or "",
        ["===SERVICES===", "===USERSERVICES===", "===CRON===", "===DISK==="],
    )
    services = _parse_services(sections["===SERVICES==="], "system")
    services += _parse_services(sections["===USERSERVICES==="], "user")
    return {
        "ok": True,
        "services": services,
        "cronjobs": _parse_cron(sections["===CRON==="]),
        "disk": _parse_disk(sections["===DISK==="]),
    }


@router.get("/projects/{project_id}/overview", response_model=ProjectOverviewResponse)
async def project_overview(project_id: int, user: dict = Depends(require_authenticated_user)):
    project = await get_project(project_id, user["id"])
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    server_id = project.get("server_id")
    root_path = (project.get("root_path") or "").strip()
    if server_id is None or not root_path:
        return {"ok": True, "has_root": False, "is_git": False, "agents_md": None, "changed_files": []}

    server = await _require_server(server_id, user)
    rp = ssh.remote_path(root_path)
    command = (
        f'echo "===GIT==="; git -C {rp} rev-parse --is-inside-work-tree 2>/dev/null; '
        f'echo "===AGENTS==="; cat {rp}/AGENTS.md 2>/dev/null; '
        f'echo "===STATUS==="; git -C {rp} status --porcelain 2>/dev/null'
    )
    result = await ssh.run_command(server, command)
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error"), "has_root": True}

    sections = _split_sections(result.get("stdout") or "", ["===GIT===", "===AGENTS===", "===STATUS==="])
    is_git = any(line.strip() == "true" for line in sections["===GIT==="])
    agents_text = "\n".join(sections["===AGENTS==="]).strip()
    return {
        "ok": True,
        "has_root": True,
        "is_git": is_git,
        "agents_md": agents_text or None,
        "changed_files": _parse_status(sections["===STATUS==="]) if is_git else [],
    }
