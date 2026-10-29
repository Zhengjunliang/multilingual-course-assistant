"""The Redis side of an answer in flight (apps/qa/inflight.py), against the real
Redis, in the test database conftest.py gives each worker.

What these pin is the part a race would break: the cap counts and reclaims on
Redis's own clock, a lease once lost stays lost, and the last event and the
end of the lease arrive together, so that a reader never mourns a finished
answer. Leases are expired by moving a score into the past rather than by
waiting for one.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, cast

import pytest

from apps.qa import inflight
from apps.qa.contract import EndEvent, TokenEvent

if TYPE_CHECKING:
    from pytest_django import Settings

QUEUED = TokenEvent(text="queued")


def admit(*, owner: int | None = None, conversation: uuid.UUID | None = None) -> uuid.UUID:
    answer_id = uuid.uuid4()
    assert inflight.admit(answer_id, QUEUED, owner=owner, conversation_id=conversation)
    return answer_id


def expire(answer_id: uuid.UUID) -> None:
    client = inflight.connection().client
    client.zadd(inflight._admitted(), {str(answer_id): 1}, xx=True)


def admitted() -> set[str]:
    return set(cast("list[str]", inflight.connection().client.zrange(inflight._admitted(), 0, -1)))


def test_the_cap_refuses_past_its_limit_and_writes_nothing(settings: Settings) -> None:
    settings.QA_MAX_IN_FLIGHT = 2
    first, second = admit(), admit()
    refused = uuid.uuid4()

    assert not inflight.admit(refused, QUEUED, owner=None, conversation_id=None)
    assert admitted() == {str(first), str(second)}
    assert inflight.read(refused, "0", block=0.01) == []


def test_an_expired_lease_gives_its_place_to_the_next_question(settings: Settings) -> None:
    settings.QA_MAX_IN_FLIGHT = 1
    crashed = admit()
    expire(crashed)

    later = admit()

    assert admitted() == {str(later)}


def test_a_renewed_lease_goes_on_until_someone_asks_it_to_stop() -> None:
    answer_id = admit()
    assert inflight.renew(answer_id) == "ok"

    inflight.stop(answer_id)

    assert inflight.renew(answer_id) == "stopped"


def test_a_lost_lease_is_not_taken_back() -> None:
    answer_id = admit()
    expire(answer_id)
    inflight.admit(uuid.uuid4(), QUEUED, owner=None, conversation_id=None)

    assert inflight.renew(answer_id) == "lost"
    assert str(answer_id) not in admitted()


def test_events_are_read_in_order_and_from_where_a_reader_left_off() -> None:
    answer_id = admit()
    inflight.emit(answer_id, TokenEvent(text="An "))
    inflight.emit(answer_id, TokenEvent(text="ORM"))

    everything = inflight.read(answer_id, "0", block=0.01)
    rest = inflight.read(answer_id, everything[1].id, block=0.01)

    assert [entry.name for entry in everything] == ["token", "token", "token"]
    assert [entry.data for entry in rest] == [TokenEvent(text="ORM").model_dump_json()]


def test_a_read_with_nothing_new_returns_empty_handed() -> None:
    answer_id = admit()
    (only,) = inflight.read(answer_id, "0", block=0.01)

    assert inflight.read(answer_id, only.id, block=0.01) == []


def test_finishing_writes_the_last_event_and_gives_the_place_back() -> None:
    answer_id = admit()
    inflight.stop(answer_id)

    inflight.finish(answer_id, EndEvent(), conversation_id=None)

    assert inflight.read(answer_id, "0", block=0.01)[-1].name == "end"
    assert admitted() == set()
    assert not inflight.connection().client.exists(inflight._stop(answer_id))


def test_a_stream_is_kept_for_a_while_after_its_last_event() -> None:
    answer_id = admit()
    inflight.finish(answer_id, EndEvent(), conversation_id=None)

    ttl = cast("int", inflight.connection().client.ttl(inflight._stream(answer_id)))

    assert 0 < ttl <= inflight.KEPT_SECONDS


def test_a_probe_reads_a_finish_that_raced_the_read_rather_than_mourning_it() -> None:
    answer_id = admit()
    (first,) = inflight.read(answer_id, "0", block=0.01)
    inflight.finish(answer_id, EndEvent(), conversation_id=None)

    assert inflight.probe(answer_id, first.id) == "more"


def test_a_probe_tells_a_working_writer_from_a_dead_one() -> None:
    answer_id = admit()
    inflight.emit(answer_id, TokenEvent(text="An "))
    *_, last = inflight.read(answer_id, "0", block=0.01)
    assert inflight.probe(answer_id, last.id) == "alive"

    expire(answer_id)

    assert inflight.probe(answer_id, last.id) == "dead"


def test_a_probe_tells_a_question_no_worker_took_from_a_dead_writer() -> None:
    """The lease gone before any worker took the question: it waited for one
    longer than it may, which a full site does and a broken one need not. A
    worker that took it and died before writing a word is a dead writer."""
    waited, taken = admit(), admit()
    assert inflight.take(taken) == "ok"
    (first,) = inflight.read(waited, "0", block=0.01)
    (other,) = inflight.read(taken, "0", block=0.01)

    expire(waited)
    expire(taken)

    assert inflight.probe(waited, first.id) == "untaken"
    assert inflight.probe(taken, other.id) == "dead"


def test_a_probe_of_an_expired_stream_says_it_is_gone() -> None:
    assert inflight.probe(uuid.uuid4(), "0") == "gone"


def test_the_stream_names_who_asked() -> None:
    signed_in, anonymous = admit(owner=42), admit()

    assert inflight.owner(signed_in) == "42"
    assert inflight.owner(anonymous) == ""
    assert inflight.owner(uuid.uuid4()) is None


def test_a_conversation_names_its_answer_in_flight_until_it_finishes() -> None:
    conversation = uuid.uuid4()
    answer_id = admit(owner=42, conversation=conversation)
    assert inflight.answering(conversation) == answer_id

    inflight.finish(answer_id, EndEvent(), conversation_id=conversation)

    assert inflight.answering(conversation) is None


def test_an_answer_finishing_late_leaves_the_conversations_next_one_alone() -> None:
    conversation = uuid.uuid4()
    earlier = admit(owner=42, conversation=conversation)
    later = admit(owner=42, conversation=conversation)

    inflight.finish(earlier, EndEvent(), conversation_id=conversation)

    assert inflight.answering(conversation) == later


def test_an_abandoned_question_leaves_nothing_behind() -> None:
    conversation = uuid.uuid4()
    answer_id = admit(owner=42, conversation=conversation)

    inflight.abandon(answer_id, conversation_id=conversation)

    assert admitted() == set()
    assert inflight.owner(answer_id) is None
    assert inflight.answering(conversation) is None


def test_a_third_reader_pushes_the_first_out() -> None:
    """An answer has two readers at most: the page, and the connection a
    reload leaves behind until the server notices it closed. The newest
    reader's join wakes the oldest from its wait and ends it, so opening one
    answer many times over holds two connections, not one each."""
    answer_id = admit()
    first, second = inflight.join(answer_id), inflight.join(answer_id)
    (queued,) = inflight.read(answer_id, "0", block=0.01, reader=first)

    inflight.join(answer_id)

    with pytest.raises(inflight.PushedOutError):
        inflight.read(answer_id, queued.id, block=5, reader=first)
    assert inflight.read(answer_id, queued.id, block=0.01, reader=second) == []
