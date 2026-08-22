"""JSON decisions from small quantized models arrive wrapped in code fences or
prose; the llm helpers must extract and validate them, and any unusable reply
must degrade to None — the caller's deterministic fallback path — never raise
mid-pipeline."""

from collections.abc import Sequence

from pydantic import BaseModel

from rag.llm import Message, complete_json, parse_json_reply


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
