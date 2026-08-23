"""JSON decisions from small quantized models arrive wrapped in code fences or
prose; the llm helpers must extract and validate them, and any unusable reply
must degrade to None — the caller's deterministic fallback path — never raise
mid-pipeline. Decoding stays reproducible: both call shapes must put the
configured temperature and seed on the wire."""

from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import BaseModel

from rag.live import STEP_TIMEOUT_SECONDS
from rag.llm import (
    DEFAULT_TIMEOUT_SECONDS,
    Message,
    build_completer,
    build_streamer,
    complete_json,
    parse_json_reply,
)


class Verdict(BaseModel):
    relevant: bool
    reason: str


class StubCompleter:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.messages: list[Message] = []

    def complete(self, messages: Sequence[Message]) -> str:
        self.messages.extend(messages)
        return self.reply


def test_parse_json_reply_unwraps_fences_and_prose() -> None:
    text = 'Sure! ```json\n{"relevant": true, "reason": "campus page"}\n``` Hope that helps.'
    verdict = parse_json_reply(text, Verdict)
    assert verdict is not None
    assert verdict.relevant is True
    assert verdict.reason == "campus page"


def test_parse_json_reply_degrades_to_none() -> None:
    assert parse_json_reply("no json anywhere", Verdict) is None
    assert parse_json_reply('{"relevant": true, "reason": ', Verdict) is None  # truncated
    assert parse_json_reply('{"unexpected": 1}', Verdict) is None  # wrong schema


def test_complete_json_round_trips_through_the_completer() -> None:
    completer = StubCompleter('{"relevant": false, "reason": "commercial page"}')
    messages: list[Message] = [{"role": "user", "content": "relevant?"}]
    verdict = complete_json(completer, messages, Verdict)
    assert verdict is not None
    assert verdict.relevant is False
    assert completer.messages == messages


class HungCompleter:
    """An endpoint that never answers: the SDK exhausts its retries and raises
    from inside `complete()`, exactly what a downed Ollama looks like."""

    def complete(self, messages: Sequence[Message]) -> str:
        import httpx
        from openai import APITimeoutError

        raise APITimeoutError(request=httpx.Request("POST", "http://localhost:11434/v1"))


def test_complete_json_degrades_a_dead_endpoint_to_none() -> None:
    """A timeout that escaped as an exception would cost the whole deepening
    turn; the callers' contract is "one step missed, not the turn", so the dead
    endpoint must land on the same None as a malformed reply."""
    messages: list[Message] = [{"role": "user", "content": "relevant?"}]
    assert complete_json(HungCompleter(), messages, Verdict) is None


class RecordingCompletions:
    """Stands in for `client.chat.completions`: records the request kwargs and
    answers in both shapes (streamed deltas / one full message)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return iter(
                [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="ok"))])]
            )
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])


def test_decoding_parameters_reach_both_call_shapes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reproducibility is a wire-level property: a temperature that never
    leaves the process would leave the server sampling. `seed` rides the SDK's
    `omit` sentinel when unset, so the field is absent rather than null."""
    from openai import omit

    completions = RecordingCompletions()
    clients: list[float] = []

    def fake_openai(base_url: str, api_key: str, timeout: float) -> Any:
        clients.append(timeout)
        return SimpleNamespace(chat=SimpleNamespace(completions=completions))

    monkeypatch.setattr("openai.OpenAI", fake_openai)
    messages: list[Message] = [{"role": "user", "content": "hi"}]

    streamer = build_streamer("http://localhost:11434/v1", "unused", "qwen3:4b")
    assert "".join(streamer.stream(messages)) == "ok"
    completer = build_completer("http://localhost:11434/v1", "unused", "qwen3:4b", seed=42)
    assert completer.complete(messages) == "ok"

    streamed, completed = completions.calls
    assert streamed["temperature"] == 0.0
    assert streamed["seed"] is omit  # unset seed is left out of the request
    assert completed["temperature"] == 0.0
    assert completed["seed"] == 42
    # Every request is bounded: the SDK's own default is ten minutes, which
    # would make the deepening loop's step budget fiction the moment an
    # endpoint stops answering.
    assert clients == [DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS]
    assert DEFAULT_TIMEOUT_SECONDS < STEP_TIMEOUT_SECONDS
