from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes.activity_events import router as activity_events_router
from api.routes.agent import router as agent_router
from api.routes.auth import router as auth_router
from api.routes.glossary import router as glossary_router
from api.routes.missions import router as missions_router
from api.routes.okrs import router as okrs_router
from api.routes.overview import router as overview_router
from api.routes.planning import router as planning_router
from api.routes.projects import router as projects_router
from api.routes.tmux import router as tmux_router
from api.routes.voice import router as voice_router
from core.activity_events import bootstrap_activity_events
from external import ssh
from config import settings

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(planning_router)
app.include_router(okrs_router)
app.include_router(missions_router)
app.include_router(projects_router)
app.include_router(tmux_router)
app.include_router(overview_router)
app.include_router(agent_router)
app.include_router(voice_router)
app.include_router(glossary_router)
app.include_router(activity_events_router)
app.include_router(auth_router)


@app.on_event("startup")
async def startup_activity_events():
    await bootstrap_activity_events()


@app.on_event("shutdown")
async def shutdown_ssh_pool():
    await ssh.close_all()


@app.get("/api/ping")
async def ping():
    return {"status": "ok"}
