from datetime import datetime
import json
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies.auth import require_authenticated_user
from config import settings
from external.openrouter import OpenRouterClient, openrouter_client
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


AI_MODEL_PRESETS: dict[str, dict[str, Any]] = {
    "high": {
        "model": "anthropic/claude-3.7-sonnet",
        "reasoning": {"effort": "high"},
        "description": "Highest quality, slower response, reasoning enabled.",
    },
    "medium": {
        "model": "openai/gpt-4o-mini",
        "reasoning": {"effort": "medium"},
        "description": "Balanced quality and speed, reasoning enabled.",
    },
    "cheap": {
        "model": "meta-llama/llama-3.1-8b-instruct",
        "reasoning": None,
        "description": "Lowest cost and fast, no reasoning block.",
    },
}


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


class GlossaryAIDraftRequest(BaseModel):
    term: str = Field(min_length=1, max_length=255)
    model_key: Literal["high", "medium", "cheap"] = "medium"


class GlossaryAIDraftResponse(BaseModel):
    term: str
    short_definition: str
    simple_definition: str
    professional_definition: str
    related_sources: str | None
    note: str | None
    related_terms: list[str]
    suggested_label_names: list[str]
    label_ids: list[int]
    model_key: Literal["high", "medium", "cheap"]
    model: str
    usage: dict[str, Any]


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


def extract_message_content(response_json: dict[str, Any]) -> str:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("AI response did not contain choices.")

    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("AI response did not contain message content.")

    content = message.get("content")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
        if parts:
            return "\n".join(parts)

    raise ValueError("AI response content format is not supported.")


def parse_json_object_from_text(text: str) -> dict[str, Any]:
    candidate = text.strip()

    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", candidate, re.DOTALL)
    if fenced_match:
        candidate = fenced_match.group(1).strip()

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI response did not contain valid JSON.")

    parsed = json.loads(candidate[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("AI response JSON payload must be an object.")
    return parsed


def normalize_string_list(values: Any, max_items: int = 40) -> list[str]:
    if not isinstance(values, list):
        return []

    cleaned_values: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        item = raw.strip()
        if not item:
            continue
        normalized = item.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        cleaned_values.append(item)
        if len(cleaned_values) >= max_items:
            break

    return cleaned_values


def match_label_ids_by_name(labels: list[dict], label_names: list[str]) -> list[int]:
    name_to_id = {label["name"].strip().casefold(): label["id"] for label in labels if isinstance(label.get("name"), str)}
    matched: list[int] = []
    for name in label_names:
        matched_id = name_to_id.get(name.strip().casefold())
        if matched_id is None:
            continue
        if matched_id in matched:
            continue
        matched.append(matched_id)
    return matched


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


@router.post("/glossary/terms/ai-draft", response_model=GlossaryAIDraftResponse)
async def generate_term_draft_with_ai_route(
    payload: GlossaryAIDraftRequest,
    user: dict = Depends(require_authenticated_user),
):
    if not settings.openrouter_api_key:
        raise HTTPException(status_code=503, detail="OpenRouter API key is not configured.")

    model_config = AI_MODEL_PRESETS[payload.model_key]
    term = normalized_text(payload.term)
    if not term:
        raise HTTPException(status_code=400, detail="Term is required.")

    labels = await list_glossary_labels(user["id"])
    existing_label_names = [label["name"] for label in labels]

    system_prompt = (
        "You are an expert startup and business glossary assistant.\n"
        "Return ONLY a valid JSON object with these keys:\n"
        "term, short_definition, simple_definition, professional_definition, related_sources, note, related_terms, suggested_labels\n"
        "Rules:\n"
        "- short_definition: single plain-text sentence, concise.\n"
        "- simple_definition: markdown, beginner-friendly explanation.\n"
        "- professional_definition: markdown, advanced business terminology.\n"
        "- related_sources: markdown list of credible resources (optional).\n"
        "- note: markdown field for practical usage and why it matters (optional).\n"
        "- related_terms: array of 5 to 10 related terms.\n"
        "- suggested_labels: choose up to 3 labels from the provided existing label names only.\n"
        "- If a value is unknown, return null (or [] for arrays), never add extra keys."
    )

    user_prompt = (
        f"Term: {term}\n"
        f"Existing labels: {json.dumps(existing_label_names, ensure_ascii=False)}\n"
        "Generate high-quality glossary content for this term."
    )

    try:
        response_json = await openrouter_client.completion(
            model=model_config["model"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=2200,
            reasoning=model_config["reasoning"],
        )
        message_content = extract_message_content(response_json)
        ai_payload = parse_json_object_from_text(message_content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc

    drafted_term = normalized_text(str(ai_payload.get("term") or term))
    short_definition = normalized_text(str(ai_payload.get("short_definition") or ""))
    simple_definition = normalized_text(str(ai_payload.get("simple_definition") or ""))
    professional_definition = normalized_text(str(ai_payload.get("professional_definition") or ""))
    related_sources = normalized_optional_text(ai_payload.get("related_sources") if isinstance(ai_payload.get("related_sources"), str) else None)
    note = normalized_optional_text(ai_payload.get("note") if isinstance(ai_payload.get("note"), str) else None)
    related_terms = normalize_related_terms(normalize_string_list(ai_payload.get("related_terms"), max_items=20))
    suggested_label_names = normalize_string_list(ai_payload.get("suggested_labels"), max_items=3)
    matched_label_ids = match_label_ids_by_name(labels, suggested_label_names)

    if not short_definition:
        short_definition = drafted_term
    if not simple_definition:
        simple_definition = short_definition
    if not professional_definition:
        professional_definition = simple_definition

    return {
        "term": drafted_term,
        "short_definition": short_definition,
        "simple_definition": simple_definition,
        "professional_definition": professional_definition,
        "related_sources": related_sources,
        "note": note,
        "related_terms": related_terms,
        "suggested_label_names": suggested_label_names,
        "label_ids": matched_label_ids,
        "model_key": payload.model_key,
        "model": model_config["model"],
        "usage": OpenRouterClient.extract_usage_summary(response_json),
    }


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
