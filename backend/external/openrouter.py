import json
import os
import time
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from config import settings


class OpenRouterClient:
    def __init__(self, api_key: str, report_jsonl_filename: Optional[str] = None):
        self.api_key = api_key
        self.report_jsonl_filename = report_jsonl_filename
        self.base_url = "https://openrouter.ai/api/v1"
        self.proxy = settings.global_access_http_proxy
        # self.base_url = "http://g.basalam.dev:8000/v1"
        # self.base_url = "http://212.80.22.149:8000/v1"
        self.headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    @staticmethod
    def extract_usage_summary(response_json: Dict[str, Any]) -> Dict[str, Any]:
        usage = response_json.get("usage") or {}
        return {
            "cost": usage.get("cost"),
            "cost_currency": usage.get("cost_currency") or "USD",
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
            "reasoning_tokens": usage.get("reasoning_tokens"),
        }

    async def completion(
        self,
        model: str,
        messages: List[Dict[str, str]],
        provider: Optional[str] = None,
        temperature: float = 0.01,
        max_tokens: Optional[int] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str] = None,
        timeout: int = 60 * 5,
        plugins: Optional[List[Dict[str, Any]]] = None,
        reasoning: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a chat completion using OpenRouter API."""
        payload = {"model": model, "messages": messages, "temperature": temperature, "usage": {"include": True}, "provider": provider}

        if max_tokens:
            payload["max_tokens"] = max_tokens

        if tools:
            payload["tools"] = tools

        if tool_choice:
            payload["tool_choice"] = tool_choice

        if reasoning:
            payload["reasoning"] = reasoning

        if plugins:
            payload["plugins"] = plugins

        client_kwargs: dict[str, Any] = {"timeout": timeout}
        if self.proxy:
            client_kwargs["proxy"] = self.proxy
        start_time = time.time()
        async with httpx.AsyncClient(**client_kwargs) as client:
            response = await client.post(f"{self.base_url}/chat/completions", headers=self.headers, json=payload)
            response_json = response.json()
            end_time = time.time()
            if os.path.isdir("logs"):
                with open(f"logs/responses-{datetime.now().strftime('%Y-%m-%d')}.jsonl", "a") as f:
                    f.write(json.dumps({"request": payload, "response": response_json}, ensure_ascii=False, indent=4) + "\n")
            if self.report_jsonl_filename:
                with open(self.report_jsonl_filename, "a") as f:
                    f.write(
                        json.dumps(
                            {"request": payload, "response": response_json, "time_taken": end_time - start_time},
                            ensure_ascii=False,
                            indent=4,
                        )
                        + "\n"
                    )
            response.raise_for_status()
            return response_json


openrouter_client = OpenRouterClient(settings.openrouter_api_key)
