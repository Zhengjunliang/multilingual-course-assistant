"""The one OpenAI-compatible client surface shared by every LLM consumer.

Stateless by design (the agent/live module boundary rule: agent reads, live
writes, llm holds no state): this module only knows how to talk to the endpoint
configured in `config/env.py` and how to coerce a completion into a validated
pydantic model. Routing, gating and generation logic live with their owners.

Two call shapes cover every consumer:
- `ChatStreamer` streams tokens (answer generation);
- `Completer` returns one full completion (JSON decisions: router, relevance
  gate, deepening verdicts), always parsed through `complete_json` so an
  unusable reply — malformed JSON, or an endpoint that never answered within
  the bound below — degrades into `None` instead of an exception mid-pipeline;
  every caller has a deterministic fallback (route -> both, gate -> do not
  persist).

Both shapes decode greedily by default (`temperature=0.0`, optional `seed`)
instead of inheriting the server's sampling defaults — an intentional
reproducibility change made when the router landed (M2.5b), so a measurement
can be repeated. Ollama's OpenAI-compatible endpoint accepts both fields.

Every request is also bounded in time. The SDK's own default is ten minutes,
which turns any caller's wall-clock budget into a fiction the moment the
endpoint stops answering — and the deepening loop has one (the step-budget ADR
in docs/fonte-web-unifi.md). This module knows nothing about who is calling it,
so the bound is a plain default here rather than an imported constant.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Protocol, cast

from pydantic import BaseModel, ValidationError

if TYPE_CHECKING:
    from collections.abc import Iterator, Sequence

    from openai import Omit

logger = logging.getLogger(__name__)

Message = dict[str, str]

# Per-request ceiling, half the deepening loop's 60s step budget: a single call
# allowed to spend the whole step would guarantee the step misses. The SDK still
# retries on top of this, so the true worst case is this bound times the retry
# count — the step clock's own check is what catches that overrun, and this
# stops one hung request from running for the SDK's default ten minutes.
DEFAULT_TIMEOUT_SECONDS = 30.0


class ChatStreamer(Protocol):
    """Streaming slice of the client; tests substitute a stub, CLIs build the
    real thing."""

    def stream(self, messages: Sequence[Message]) -> Iterator[str]: ...


class Completer(Protocol):
    """Single-shot slice: one prompt in, the full completion text out."""

    def complete(self, messages: Sequence[Message]) -> str: ...


class _OpenAIClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.0,
        seed: int | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        from openai import OpenAI, omit

        self._client = OpenAI(base_url=base_url, api_key=api_key, timeout=timeout)
        self._model = model
        self._temperature = temperature
        # `omit` is the SDK sentinel for "leave the field out of the request":
        # a server that does not implement `seed` can reject an explicit null
        # where an absent field costs nothing.
        self._seed: int | Omit = omit if seed is None else seed

    def stream(self, messages: Sequence[Message]) -> Iterator[str]:
        events = self._client.chat.completions.create(
            model=self._model,
            messages=cast("Any", list(messages)),  # our Message shape matches the typed dicts
            stream=True,
            temperature=self._temperature,
            seed=self._seed,
        )
        for event in events:
            delta = event.choices[0].delta.content
            if delta:
                yield delta

    def complete(self, messages: Sequence[Message]) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=cast("Any", list(messages)),
            temperature=self._temperature,
            seed=self._seed,
        )
        return response.choices[0].message.content or ""


def build_streamer(
    base_url: str,
    api_key: str,
    model: str,
    temperature: float = 0.0,
    seed: int | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> ChatStreamer:
    return _OpenAIClient(base_url, api_key, model, temperature, seed, timeout)


def build_completer(
    base_url: str,
    api_key: str,
    model: str,
    temperature: float = 0.0,
    seed: int | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> Completer:
    return _OpenAIClient(base_url, api_key, model, temperature, seed, timeout)


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
    """One completion parsed against a schema; `None` is the only failure shape.

    An endpoint that times out or refuses the connection lands on the same
    `None` as a malformed reply: the callers' fallback paths promise "one step
    missed, not the turn", and a timeout that escaped as an exception would
    cost the whole loop. `APITimeoutError` subclasses `APIConnectionError`, so
    one except covers both.
    """
    from openai import APIConnectionError

    try:
        reply = completer.complete(messages)
    except APIConnectionError as error:
        logger.warning("completion request failed (%s): no usable reply", type(error).__name__)
        return None
    return parse_json_reply(reply, schema)
