from datetime import datetime
import json
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError

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
    "gemini_3_1_pro": {
        "model": "google/gemini-3.1-pro-preview",
        "reasoning": {"effort": "high"},
        "description": "High reasoning quality.",
    },
    "claude_3_5_haiku": {
        "model": "anthropic/claude-3.5-haiku",
        "reasoning": {"effort": "high"},
        "description": "High reasoning quality with lower cost.",
    },
    "gemini_3_flash": {
        "model": "google/gemini-3-flash-preview",
        "reasoning": {"effort": "medium"},
        "description": "Medium-high reasoning and faster generation.",
    },
    "gpt_4o_mini": {
        "model": "openai/gpt-4o-mini",
        "reasoning": {"effort": "high"},
        "description": "High reasoning with strong price/performance.",
    },
    "llama_3_1_8b": {
        "model": "meta-llama/llama-3.1-8b-instruct",
        "reasoning": {"effort": "medium"},
        "description": "Lowest cost option with medium reasoning.",
    },
    "cheap": {
        "model": "meta-llama/llama-3.1-8b-instruct",
        "reasoning": None,
        "description": "Legacy key mapped to the cheapest model.",
    },
    "high": {
        "model": "google/gemini-3.1-pro-preview",
        "reasoning": {"effort": "high"},
        "description": "Legacy key mapped to highest-tier model.",
    },
    "medium": {
        "model": "google/gemini-3-flash-preview",
        "reasoning": {"effort": "medium"},
        "description": "Legacy key mapped to balanced model.",
    },
}


AiModelKey = Literal[
    "gemini_3_1_pro",
    "claude_3_5_haiku",
    "gemini_3_flash",
    "gpt_4o_mini",
    "llama_3_1_8b",
    "high",
    "medium",
    "cheap",
]


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
    model_key: AiModelKey = "gemini_3_flash"


class GlossaryAIDraftResponse(BaseModel):
    term: str
    short_definition: str
    simple_definition: str
    professional_definition: str
    related_sources: str
    note: str | None
    related_terms: list[str]
    suggested_label_names: list[str]
    label_ids: list[int]
    model_key: AiModelKey
    model: str
    usage: dict[str, Any]


class GlossaryAIToolPayload(BaseModel):
    term: str = Field(min_length=1, max_length=255)
    short_definition: str = Field(min_length=1, max_length=300)
    simple_definition: str = Field(min_length=1, max_length=12000)
    professional_definition: str = Field(min_length=1, max_length=16000)
    related_sources: str = Field(min_length=1, max_length=16000)
    note: str | None = Field(default=None, max_length=16000)
    related_terms: list[str] = Field(default_factory=list, max_length=20)
    suggested_labels: list[str] = Field(default_factory=list, max_length=3)


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


def extract_tool_arguments(response_json: dict[str, Any], tool_name: str) -> dict[str, Any]:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("AI response did not contain choices.")

    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("AI response did not contain message.")

    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list) or not tool_calls:
        raise ValueError("AI response did not contain tool calls.")

    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        function_payload = tool_call.get("function")
        if not isinstance(function_payload, dict):
            continue
        if function_payload.get("name") != tool_name:
            continue

        arguments = function_payload.get("arguments")
        if isinstance(arguments, str):
            parsed = json.loads(arguments)
            if isinstance(parsed, dict):
                return parsed
        if isinstance(arguments, dict):
            return arguments

    raise ValueError(f"AI response did not include expected tool call '{tool_name}'.")


MARKDOWN_LIST_ITEM_PATTERN = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")
ARTICLES_HEADING_PATTERN = re.compile(r"^#{2,6}\s*Influential articles, posts, or threads\s*$", re.IGNORECASE)
BOOKS_HEADING_PATTERN = re.compile(r"^#{2,6}\s*Related books\s*$", re.IGNORECASE)


def validate_related_sources_markdown(value: str) -> str:
    lines = value.splitlines()

    in_section: Literal["articles", "books", None] = None
    has_articles_heading = False
    has_books_heading = False
    articles_count = 0
    books_count = 0

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        if ARTICLES_HEADING_PATTERN.match(line):
            has_articles_heading = True
            in_section = "articles"
            continue
        if BOOKS_HEADING_PATTERN.match(line):
            has_books_heading = True
            in_section = "books"
            continue

        if MARKDOWN_LIST_ITEM_PATTERN.match(line):
            if in_section == "articles":
                articles_count += 1
            elif in_section == "books":
                books_count += 1

    if not has_articles_heading or not has_books_heading:
        raise ValueError("related_sources must include both required markdown sections.")
    if articles_count < 1 or articles_count > 5:
        raise ValueError("related_sources must include 1 to 5 article/post/thread items.")
    if books_count < 1 or books_count > 3:
        raise ValueError("related_sources must include 1 to 3 book items.")

    return value.strip()


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
    draft_tool_name = "submit_glossary_term_draft"

    system_prompt = (
        "You are an expert startup and business glossary assistant.\n"
        "Use the provided function exactly once and pass all required fields.\n"
        "Content rules:\n"
        "- short_definition: one concise plain-text sentence.\n"
        "- simple_definition: markdown, beginner-friendly explanation.\n"
        "- professional_definition: markdown, advanced business terminology.\n"
        "- related_sources: markdown with exactly these sections:\n"
        "  ### Influential articles, posts, or threads\n"
        "  ### Related books\n"
        "  Include 1-5 bullets in the first section and 1-3 bullets in the second section.\n"
        "- note: markdown personal notes; may be null.\n"
        "- related_terms: 5 to 10 related terms.\n"
        "- suggested_labels: choose up to 3 labels only from provided existing labels."
    )

    user_prompt = (
        f"Term: {term}\n"
        f"Existing labels: {json.dumps(existing_label_names, ensure_ascii=False)}\n"
        "Generate high-quality glossary content for this term."
    )

    draft_tool = [
        {
            "type": "function",
            "function": {
                "name": draft_tool_name,
                "description": "Submit structured glossary draft content.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "term",
                        "short_definition",
                        "simple_definition",
                        "professional_definition",
                        "related_sources",
                        "related_terms",
                        "suggested_labels",
                    ],
                    "properties": {
                        "term": {"type": "string", "minLength": 1, "maxLength": 255},
                        "short_definition": {"type": "string", "minLength": 1, "maxLength": 300},
                        "simple_definition": {"type": "string", "minLength": 1, "maxLength": 12000},
                        "professional_definition": {"type": "string", "minLength": 1, "maxLength": 16000},
                        "related_sources": {"type": "string", "minLength": 1, "maxLength": 16000},
                        "note": {"type": ["string", "null"], "maxLength": 16000},
                        "related_terms": {
                            "type": "array",
                            "minItems": 5,
                            "maxItems": 10,
                            "items": {"type": "string", "minLength": 1, "maxLength": 120},
                        },
                        "suggested_labels": {
                            "type": "array",
                            "maxItems": 3,
                            "items": {"type": "string", "minLength": 1, "maxLength": 64},
                        },
                    },
                },
            },
        }
    ]

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
            tools=draft_tool,
            tool_choice={"type": "function", "function": {"name": draft_tool_name}},
        )
        ai_payload = extract_tool_arguments(response_json, draft_tool_name)
        validated_payload = GlossaryAIToolPayload.model_validate(ai_payload)
    except ValidationError as exc:
        raise HTTPException(status_code=502, detail=f"AI output schema validation failed: {exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc

    drafted_term = normalized_text(validated_payload.term or term)
    short_definition = normalized_text(validated_payload.short_definition)
    simple_definition = normalized_text(validated_payload.simple_definition)
    professional_definition = normalized_text(validated_payload.professional_definition)
    try:
        related_sources = validate_related_sources_markdown(normalized_text(validated_payload.related_sources))
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"AI related_sources format invalid: {exc}") from exc
    note = normalized_optional_text(validated_payload.note)
    related_terms = normalize_related_terms(validated_payload.related_terms)
    suggested_label_names = normalize_string_list(validated_payload.suggested_labels, max_items=3)
    matched_label_ids = match_label_ids_by_name(labels, suggested_label_names)

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
