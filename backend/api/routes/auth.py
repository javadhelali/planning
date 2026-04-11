from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import get_authenticated_session, require_authenticated_user
from core.auth import authenticate_user, create_user_session, register_user, revoke_user_session


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    id: int
    username: str
    created_at: datetime
    updated_at: datetime


class LoginResponse(BaseModel):
    token: str
    user: AuthUserResponse


class LogoutResponse(BaseModel):
    logged_out: bool


@router.post("/register", response_model=AuthUserResponse, status_code=status.HTTP_201_CREATED)
async def register_route(payload: RegisterRequest):
    try:
        user = await register_user(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return user


@router.post("/login", response_model=LoginResponse)
async def login_route(payload: LoginRequest):
    user = await authenticate_user(payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = await create_user_session(user["id"])
    return {"token": token, "user": user}


@router.get("/me", response_model=AuthUserResponse)
async def me_route(user: dict = Depends(require_authenticated_user)):
    return user


@router.post("/logout", response_model=LogoutResponse)
async def logout_route(session: dict = Depends(get_authenticated_session)):
    logged_out = await revoke_user_session(session["token"])
    return {"logged_out": logged_out}
