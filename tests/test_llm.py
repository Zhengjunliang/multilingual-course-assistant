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

from rag.llm import Message, build_completer, build_streamer, complete_json, parse_json_reply


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

    def fake_openai(base_url: str, api_key: str) -> Any:
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
