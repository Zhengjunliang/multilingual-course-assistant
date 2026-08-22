"""The one OpenAI-compatible client surface shared by every LLM consumer.

Stateless by design (the agent/live module boundary rule: agent reads, live
writes, llm holds no state): this module only knows how to talk to the endpoint
configured in `config/env.py` and how to coerce a completion into a validated
pydantic model. Routing, gating and generation logic live with their owners.

Two call shapes cover every consumer:
- `ChatStreamer` streams tokens (answer generation);
- `Completer` returns one full completion (JSON decisions: router, relevance
  gate, deepening verdicts), always parsed through `complete_json` so a
  malformed reply degrades into `None` instead of an exception mid-pipeline —
  every caller has a deterministic fallback (route -> both, gate -> do not
  persist).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Protocol, cast

from pydantic import BaseModel, ValidationError

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

logger = logging.getLogger(__name__)

Message = dict[str, str]


class ChatStreamer(Protocol):
    """Streaming slice of the client; tests substitute a stub, CLIs build the
    real thing."""

    def stream(self, messages: Sequence[Message]) -> Iterator[str]: ...


class Completer(Protocol):
    """Single-shot slice: one prompt in, the full completion text out."""

    def complete(self, messages: Sequence[Message]) -> str: ...


class _OpenAIClient:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        from openai import OpenAI

        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    def stream(self, messages: Sequence[Message]) -> Iterator[str]:
        events = self._client.chat.completions.create(
            model=self._model,
            messages=cast("Any", list(messages)),  # our Message shape matches the typed dicts
            stream=True,
        )
        for event in events:
            delta = event.choices[0].delta.content
            if delta:
                yield delta

    def complete(self, messages: Sequence[Message]) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=cast("Any", list(messages)),
        )
        return response.choices[0].message.content or ""


def build_streamer(base_url: str, api_key: str, model: str) -> ChatStreamer:
    return _OpenAIClient(base_url, api_key, model)


def build_completer(base_url: str, api_key: str, model: str) -> Completer:
    return _OpenAIClient(base_url, api_key, model)


def parse_json_reply[ModelT: BaseModel](text: str, schema: type[ModelT]) -> ModelT | None:
    """Validate a model reply against a pydantic schema; None means unusable.

    Quantized small models wrap JSON in code fences or prose, so the parse
    window is the outermest brace pair rather than the raw reply. Anything that
    still fails validation is logged and dropped — the caller's fallback path
    is the contract, never an exception.
    """
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        logger.warning("no JSON object in model reply: %.200s", text)
        return None
    try:
        return schema.model_validate_json(text[start : end + 1])
    except ValidationError:
        logger.warning("model reply failed %s validation: %.200s", schema.__name__, text)
        return None


def complete_json[ModelT: BaseModel](
    completer: Completer, messages: Sequence[Message], schema: type[ModelT]
) -> ModelT | None:
    return parse_json_reply(completer.complete(messages), schema)
