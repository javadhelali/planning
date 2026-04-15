from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from repositories.glossary import (
    create_glossary_label,
    create_glossary_term,
    delete_glossary_label,
    delete_glossary_term,
    list_glossary_labels_by_ids,
    list_glossary_labels,
    list_glossary_terms,
    update_glossary_label,
    update_glossary_term,
)

router = APIRouter(prefix="/planning", tags=["glossary"])


class GlossaryLabelResponse(BaseModel):
    id: int
    user_id: int
    name: str
    color: str
    created_at: datetime
    updated_at: datetime


class GlossaryLabelSummary(BaseModel):
    id: int
    name: str
    color: str
    created_at: datetime
    updated_at: datetime


class GlossaryTermResponse(BaseModel):
    id: int
    user_id: int
    term: str
    short_definition: str
    simple_definition: str
    professional_definition: str
    related_sources: str | None
    note: str | None
    related_terms: list[str]
    labels: list[GlossaryLabelSummary]
    created_at: datetime
    updated_at: datetime


class GlossarySnapshotResponse(BaseModel):
    labels: list[GlossaryLabelResponse]
    terms: list[GlossaryTermResponse]


class GlossaryLabelRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str = Field(min_length=7, max_length=7, pattern=r"^#[0-9A-Fa-f]{6}$")


class GlossaryTermRequest(BaseModel):
    term: str = Field(min_length=1, max_length=255)
    short_definition: str = Field(min_length=1, max_length=300)
    simple_definition: str = Field(min_length=1, max_length=12000)
    professional_definition: str = Field(min_length=1, max_length=16000)
    related_sources: str | None = Field(default=None, max_length=16000)
    note: str | None = Field(default=None, max_length=16000)
    related_terms: list[str] = Field(default_factory=list, max_length=40)
    label_ids: list[int] = Field(default_factory=list, max_length=20)


class DeleteResponse(BaseModel):
    deleted: bool


def normalized_text(value: str) -> str:
    return value.strip()


def normalized_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.strip()
    return cleaned if cleaned else None


def normalize_related_terms(values: list[str]) -> list[str]:
    cleaned_values: list[str] = []
    seen: set[str] = set()

    for value in values:
        cleaned = value.strip()
        if not cleaned:
            continue

        normalized_key = cleaned.casefold()
        if normalized_key in seen:
            continue

        seen.add(normalized_key)
        cleaned_values.append(cleaned)

    return cleaned_values


def normalize_label_ids(values: list[int]) -> list[int]:
    cleaned_values: list[int] = []
    seen: set[int] = set()

    for value in values:
        if value <= 0:
            continue
        if value in seen:
            continue
        seen.add(value)
        cleaned_values.append(value)

    return cleaned_values


def normalize_color(value: str) -> str:
    return value.strip().lower()


@router.get("/glossary", response_model=GlossarySnapshotResponse)
async def get_glossary(user: dict = Depends(require_authenticated_user)):
    labels = await list_glossary_labels(user["id"])
    terms = await list_glossary_terms(user["id"])
    return {"labels": labels, "terms": terms}


@router.post("/glossary/labels", response_model=GlossaryLabelResponse, status_code=status.HTTP_201_CREATED)
async def create_label_route(
    payload: GlossaryLabelRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    color = normalize_color(payload.color)
    if not name:
        raise HTTPException(status_code=400, detail="Label name is required.")

    try:
        label = await create_glossary_label(user["id"], name, color)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if label is None:
        raise HTTPException(status_code=500, detail="Failed to create label.")
    return label


@router.put("/glossary/labels/{label_id}", response_model=GlossaryLabelResponse)
async def update_label_route(
    label_id: int,
    payload: GlossaryLabelRequest,
    user: dict = Depends(require_authenticated_user),
):
    name = normalized_text(payload.name)
    color = normalize_color(payload.color)
    if not name:
        raise HTTPException(status_code=400, detail="Label name is required.")

    try:
        label = await update_glossary_label(user["id"], label_id, name, color)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if label is None:
        raise HTTPException(status_code=404, detail="Label not found.")
    return label


@router.delete("/glossary/labels/{label_id}", response_model=DeleteResponse)
async def delete_label_route(label_id: int, user: dict = Depends(require_authenticated_user)):
    deleted = await delete_glossary_label(user["id"], label_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Label not found.")
    return {"deleted": True}


@router.post("/glossary/terms", response_model=GlossaryTermResponse, status_code=status.HTTP_201_CREATED)
async def create_term_route(
    payload: GlossaryTermRequest,
    user: dict = Depends(require_authenticated_user),
):
    term = normalized_text(payload.term)
    short_definition = normalized_text(payload.short_definition)
    simple_definition = normalized_text(payload.simple_definition)
    professional_definition = normalized_text(payload.professional_definition)
    related_sources = normalized_optional_text(payload.related_sources)
    note = normalized_optional_text(payload.note)
    related_terms = normalize_related_terms(payload.related_terms)
    label_ids = normalize_label_ids(payload.label_ids)

    if not term:
        raise HTTPException(status_code=400, detail="Term is required.")
    if not short_definition:
        raise HTTPException(status_code=400, detail="Short definition is required.")
    if not simple_definition:
        raise HTTPException(status_code=400, detail="Simple definition is required.")
    if not professional_definition:
        raise HTTPException(status_code=400, detail="Professional definition is required.")

    if label_ids:
        existing_labels = await list_glossary_labels_by_ids(user["id"], label_ids)
        if len(existing_labels) != len(label_ids):
            raise HTTPException(status_code=404, detail="One or more labels were not found.")

    try:
        glossary_term = await create_glossary_term(
            user_id=user["id"],
            term=term,
            short_definition=short_definition,
            simple_definition=simple_definition,
            professional_definition=professional_definition,
            related_sources=related_sources,
            note=note,
            related_terms=related_terms,
            label_ids=label_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if glossary_term is None:
        raise HTTPException(status_code=500, detail="Failed to create term.")
    return glossary_term


@router.put("/glossary/terms/{term_id}", response_model=GlossaryTermResponse)
async def update_term_route(
    term_id: int,
    payload: GlossaryTermRequest,
    user: dict = Depends(require_authenticated_user),
):
    term = normalized_text(payload.term)
    short_definition = normalized_text(payload.short_definition)
    simple_definition = normalized_text(payload.simple_definition)
    professional_definition = normalized_text(payload.professional_definition)
    related_sources = normalized_optional_text(payload.related_sources)
    note = normalized_optional_text(payload.note)
    related_terms = normalize_related_terms(payload.related_terms)
    label_ids = normalize_label_ids(payload.label_ids)

    if not term:
        raise HTTPException(status_code=400, detail="Term is required.")
    if not short_definition:
        raise HTTPException(status_code=400, detail="Short definition is required.")
    if not simple_definition:
        raise HTTPException(status_code=400, detail="Simple definition is required.")
    if not professional_definition:
        raise HTTPException(status_code=400, detail="Professional definition is required.")

    if label_ids:
        existing_labels = await list_glossary_labels_by_ids(user["id"], label_ids)
        if len(existing_labels) != len(label_ids):
            raise HTTPException(status_code=404, detail="One or more labels were not found.")

    try:
        glossary_term = await update_glossary_term(
            user_id=user["id"],
            term_id=term_id,
            term=term,
            short_definition=short_definition,
            simple_definition=simple_definition,
            professional_definition=professional_definition,
            related_sources=related_sources,
            note=note,
            related_terms=related_terms,
            label_ids=label_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if glossary_term is None:
        raise HTTPException(status_code=404, detail="Term not found.")
    return glossary_term


@router.delete("/glossary/terms/{term_id}", response_model=DeleteResponse)
async def delete_term_route(term_id: int, user: dict = Depends(require_authenticated_user)):
    deleted = await delete_glossary_term(user["id"], term_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Term not found.")
    return {"deleted": True}
