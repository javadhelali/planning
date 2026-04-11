from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes.auth import router as auth_router
from api.routes.planning import router as planning_router
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
app.include_router(auth_router)

@app.get("/api/ping")
async def ping():
    return {"status": "ok"}
