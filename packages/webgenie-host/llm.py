"""
LLM client — supports OpenAI, Anthropic, and Ollama (local).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Generator, Literal

import requests

logger = logging.getLogger("llm")

Provider = Literal["openai", "anthropic", "ollama", "azure_openai"]


class LLMMessage:
    def __init__(self, role: str, content: str | list[dict[str, Any]]) -> None:
        self.role = role
        self.content = content

    def to_openai(self) -> dict[str, Any]:
        return {"role": self.role, "content": self.content}

    def to_anthropic(self) -> dict[str, Any]:
        if isinstance(self.content, str):
            return {"role": self.role, "content": self.content}
        return {"role": self.role, "content": self.content}


class LLMClient:
    def __init__(
        self,
        provider: Provider | None = None,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> None:
        self.provider = provider or self._detect_provider()
        self.model = model or self._default_model()
        self.api_key = api_key or self._get_api_key()
        self.base_url = base_url or self._default_base_url()
        self.temperature = temperature
        self.max_tokens = max_tokens
        logger.info("LLM client: provider=%s model=%s", self.provider, self.model)

    # ─── Provider detection ───────────────────────────────────────────────────

    def _detect_provider(self) -> Provider:
        if os.getenv("ANTHROPIC_API_KEY"):
            return "anthropic"
        if os.getenv("OPENAI_API_KEY"):
            return "openai"
        if os.getenv("AZURE_OPENAI_API_KEY"):
            return "azure_openai"
        return "ollama"

    def _default_model(self) -> str:
        defaults: dict[Provider, str] = {
            "openai": "gpt-4o",
            "anthropic": "claude-opus-4-5",
            "ollama": os.getenv("OLLAMA_MODEL", "llama3.2"),
            "azure_openai": os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
        }
        return defaults.get(self.provider, "gpt-4o")

    def _get_api_key(self) -> str:
        keys: dict[Provider, str] = {
            "openai": os.getenv("OPENAI_API_KEY", ""),
            "anthropic": os.getenv("ANTHROPIC_API_KEY", ""),
            "ollama": "",
            "azure_openai": os.getenv("AZURE_OPENAI_API_KEY", ""),
        }
        return keys.get(self.provider, "")

    def _default_base_url(self) -> str:
        urls: dict[Provider, str] = {
            "openai": "https://api.openai.com/v1",
            "anthropic": "https://api.anthropic.com/v1",
            "ollama": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            "azure_openai": os.getenv("AZURE_OPENAI_ENDPOINT", ""),
        }
        return urls.get(self.provider, "https://api.openai.com/v1")

    # ─── Core completion ──────────────────────────────────────────────────────

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        """Send a chat completion request. Returns OpenAI-compatible response."""
        if self.provider == "anthropic":
            return self._anthropic_chat(messages, tools)
        return self._openai_chat(messages, tools, stream)

    def _openai_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        stream: bool = False,
    ) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        if self.provider == "azure_openai":
            headers = {
                "Content-Type": "application/json",
                "api-key": self.api_key,
            }
            url = f"{self.base_url}/openai/deployments/{self.model}/chat/completions?api-version=2024-02-01"
        else:
            url = f"{self.base_url}/chat/completions"

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()

    def _anthropic_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        """Convert to Anthropic API format and return OpenAI-compatible response."""
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }

        # Split system message out
        system = ""
        filtered = []
        for m in messages:
            if m["role"] == "system":
                system = m["content"] if isinstance(m["content"], str) else str(m["content"])
            else:
                filtered.append(m)

        # Convert tool schema
        anthropic_tools = []
        if tools:
            for t in tools:
                fn = t.get("function", t)
                anthropic_tools.append({
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
                })

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": filtered,
        }
        if system:
            payload["system"] = system
        if anthropic_tools:
            payload["tools"] = anthropic_tools

        resp = requests.post(
            f"{self.base_url}/messages",
            headers=headers,
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()

        # Convert Anthropic response to OpenAI format
        return self._anthropic_to_openai(data)

    def _anthropic_to_openai(self, data: dict[str, Any]) -> dict[str, Any]:
        """Normalise Anthropic response to OpenAI format."""
        content_blocks = data.get("content", [])
        text = ""
        tool_calls = []

        for i, block in enumerate(content_blocks):
            if block["type"] == "text":
                text += block["text"]
            elif block["type"] == "tool_use":
                tool_calls.append({
                    "id": block.get("id", f"call_{i}"),
                    "type": "function",
                    "function": {
                        "name": block["name"],
                        "arguments": json.dumps(block.get("input", {})),
                    },
                })

        message: dict[str, Any] = {"role": "assistant", "content": text or None}
        if tool_calls:
            message["tool_calls"] = tool_calls

        stop_reason = data.get("stop_reason", "end_turn")
        finish_reason = "tool_calls" if tool_calls else ("stop" if stop_reason == "end_turn" else stop_reason)

        return {
            "id": data.get("id", ""),
            "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
            "usage": data.get("usage", {}),
        }

    # ─── Convenience ─────────────────────────────────────────────────────────

    def extract_text(self, response: dict[str, Any]) -> str:
        choice = response.get("choices", [{}])[0]
        return choice.get("message", {}).get("content") or ""

    def extract_tool_calls(self, response: dict[str, Any]) -> list[dict[str, Any]]:
        choice = response.get("choices", [{}])[0]
        return choice.get("message", {}).get("tool_calls") or []

    def finish_reason(self, response: dict[str, Any]) -> str:
        choice = response.get("choices", [{}])[0]
        return choice.get("finish_reason", "stop")
