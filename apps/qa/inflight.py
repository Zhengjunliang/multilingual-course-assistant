"""What an answer in flight keeps in Redis, and the one module that touches it.

A question is answered on a Celery worker (apps/qa/tasks.py) while the web
process that took it relays the events to the browser (apps/qa/views.py).
The two meet here, in seven kinds of key under `QA_KEY_PREFIX`
(config/settings.py), each named by the answer's id:

- `<prefix>:admitted`, a sorted set: one member per answer admitted and not
  yet finished, scored by the moment its lease ends. Counting its members is
  the global cap.
- `<prefix>:answer:<id>`, the answer's stream: one entry per event, its
  fields `event` and `data` (the event's name and its JSON,
  apps/qa/contract.py). The first entry also carries `owner`: the asking
  account's id, or empty for an anonymous question.
- `<prefix>:stop:<id>`, present once someone asked the answer to stop.
- `<prefix>:taken:<id>`, present once a worker took the question.
- `<prefix>:conversation:<id>`, the answer a conversation is waiting for,
  so that a page reloaded mid-answer finds it.
- `<prefix>:readers:<id>`, a list: the connections reading the answer,
  oldest first, `MAX_READERS` at most.
- `<prefix>:joins:<id>`, a stream with one entry per reader that joined,
  which wakes the readers already waiting so that the one pushed out ends.

**One clock.** Every decision about a lease runs as a Lua script on Redis's
own `TIME`, so the web host's clock and the worker's never have to agree on
when a lease ends. A lease is what makes a crashed worker's place come back by
itself: the worker renews it while it works, and an answer whose lease has
run out is counted no more and reported dead to whoever is reading it.

**Why a stream.** It keeps what was written, unlike pub/sub: a reader who
arrives late, or comes back after a reload, reads from the start or from the
last event it saw (`Last-Event-ID`), which is the resumable stream LibreChat
keeps in Redis too (outside the repository). Its entry ids are the SSE ids.

Its own redis-py client rather than Django's cache, whose client is private
API: the URL is the same `REDIS_URL`, read when first used.
"""

from __future__ import annotations

import functools
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast
from uuid import UUID

from django.conf import settings
from redis import Redis

if TYPE_CHECKING:
    from redis.commands.core import Script
    from redis.typing import KeyT, StreamIdT

    from apps.qa.contract import Event

# How long an admitted question may wait for a worker to take it. Past it the
# question is dead to its reader and its place is counted no more; a worker
# that takes it late finds the lease gone and drops it.
QUEUED_LEASE_SECONDS = 120

# The lease a worker holds while it answers, renewed every second
# (apps/qa/tasks.py). Long enough to ride out a renewal that a slow Redis
# reply delays, short enough that a crashed worker's place is back in half a
# minute.
RUNNING_LEASE_SECONDS = 30

# How long a stream is kept after its last event. A signed-in student's answer
# is in the database by then, and the stream only serves a reader whose
# reconnect races the end; OpenAI keeps an unstored background response about
# ten minutes (its Background mode guide, outside the repository).
KEPT_SECONDS = 10 * 60

# How many connections read one answer at once: the page, and the one a
# reload leaves behind until the server notices it closed. A newer reader
# pushes the oldest out, so that opening one answer many times over holds two
# of the web process's threads rather than one each.
MAX_READERS = 2

# Dify's stop flag lives ten minutes too (`set_stop_flag`, outside the
# repository), longer than any answer runs.
STOP_SECONDS = 10 * 60

# How long a read waits for the next event before returning empty-handed. The
# relay uses the pause to send a keepalive and ask whether the writer is alive
# (`probe`), so this is also how late a dead worker is noticed.
READ_BLOCK_SECONDS = 10.0

Renewal = Literal["ok", "stopped", "lost"]
Probe = Literal["more", "alive", "dead", "untaken", "gone"]

_NOW = """
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
"""

# KEYS: admitted, stream[, conversation]. ARGV: cap, lease, id, event, data,
# owner, ttl. Expired members go first, so a crashed worker's place is free
# before the count is taken.
_ADMIT = (
    _NOW
    + """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('XADD', KEYS[2], '*', 'event', ARGV[4], 'data', ARGV[5], 'owner', ARGV[6])
redis.call('EXPIRE', KEYS[2], ARGV[7])
if KEYS[3] then
  redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[7])
end
return 1
"""
)

# KEYS: admitted, stop[, taken]. ARGV: id, lease[, ttl]. `XX`, because a
# member the cap has already reclaimed must stay out: added back, it would
# overfill the cap while its reader has already been told the answer died.
# With `taken`, the worker's first renewal marks the question as taken.
_RENEW = (
    _NOW
    + """
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) <= now then
  return 'lost'
end
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[2]), ARGV[1])
if KEYS[3] then
  redis.call('SET', KEYS[3], 1, 'EX', ARGV[3])
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 'stopped'
end
return 'ok'
"""
)

# KEYS: admitted, stream, stop[, conversation]. ARGV: id, event, data, kept.
# The last event and the end of the lease in one step: a reader who finds the
# lease gone has therefore either read the last event already or will read it
# next, never neither (`_PROBE`). An empty event name writes none, for an
# answer whose reader was already told it died.
_FINISH = """
if ARGV[2] ~= '' then
  redis.call('XADD', KEYS[2], '*', 'event', ARGV[2], 'data', ARGV[3])
  redis.call('EXPIRE', KEYS[2], ARGV[4])
end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[3])
if KEYS[4] and redis.call('GET', KEYS[4]) == ARGV[1] then
  redis.call('DEL', KEYS[4])
end
return 1
"""

# KEYS: admitted, stream, taken. ARGV: id, the last entry id read. New
# entries first, so a writer that finished between the read and this probe is
# read, not mourned. A lease gone from a question no worker took, whose stream
# holds `admit`'s first entry alone, is a question that waited too long.
_PROBE = (
    _NOW
    + """
if redis.call('EXISTS', KEYS[2]) == 0 then
  return 'gone'
end
if #redis.call('XRANGE', KEYS[2], '(' .. ARGV[2], '+', 'COUNT', 1) > 0 then
  return 'more'
end
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) <= now then
  if redis.call('EXISTS', KEYS[3]) == 0 and redis.call('XLEN', KEYS[2]) == 1 then
    return 'untaken'
  end
  return 'dead'
end
return 'alive'
"""
)

# KEYS: readers, joins. ARGV: reader, most, ttl. Returns the join's entry id.
_JOIN = """
redis.call('RPUSH', KEYS[1], ARGV[1])
while redis.call('LLEN', KEYS[1]) > tonumber(ARGV[2]) do
  redis.call('LPOP', KEYS[1])
end
local id = redis.call('XADD', KEYS[2], 'MAXLEN', ARGV[2], '*', 'reader', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return id
"""


@dataclass(frozen=True)
class Entry:
    """One event as the stream holds it: its id, its name and its JSON."""

    id: str
    name: str
    data: str


@dataclass
class Reader:
    """One connection reading an answer: its id among the answer's readers,
    and the last join it has seen, which `read` moves on."""

    id: str
    seen: str


class PushedOutError(Exception):
    """A newer reader of the same answer took this one's place."""


@dataclass(frozen=True)
class _Connection:
    client: Redis
    admit: Script
    renew: Script
    finish: Script
    probe: Script
    join: Script


@functools.lru_cache(maxsize=1)
def _connect(url: str) -> _Connection:
    # A read blocks for READ_BLOCK_SECONDS by design, so the socket waits
    # longer than that; the cache's five seconds (config/settings.py) would
    # turn every quiet stretch of an answer into a timeout.
    client = Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=READ_BLOCK_SECONDS + 5,
    )
    return _Connection(
        client=client,
        admit=client.register_script(_ADMIT),
        renew=client.register_script(_RENEW),
        finish=client.register_script(_FINISH),
        probe=client.register_script(_PROBE),
        join=client.register_script(_JOIN),
    )


def connection() -> _Connection:
    """The client for `REDIS_URL`, made on first use and kept for the process."""
    return _connect(settings.REDIS_URL)


def connected() -> bool:
    """Whether this process has opened the connection; tests clear only then."""
    return _connect.cache_info().currsize > 0


def _key(*parts: object) -> str:
    return ":".join((settings.QA_KEY_PREFIX, *map(str, parts)))


def _admitted() -> str:
    return _key("admitted")


def _stream(answer_id: UUID) -> str:
    return _key("answer", answer_id)


def _stop(answer_id: UUID) -> str:
    return _key("stop", answer_id)


def _waiting(conversation_id: UUID) -> str:
    return _key("conversation", conversation_id)


def _taken(answer_id: UUID) -> str:
    return _key("taken", answer_id)


def _readers(answer_id: UUID) -> str:
    return _key("readers", answer_id)


def _joins(answer_id: UUID) -> str:
    return _key("joins", answer_id)


def admit(
    answer_id: UUID, first: Event, *, owner: int | None, conversation_id: UUID | None
) -> bool:
    """Take a place under the cap and open the answer's stream with `first`.

    False when the cap is full, and then nothing is written. The stream lives
    as long as the question may wait plus `KEPT_SECONDS`, so one no worker
    ever takes still goes away.
    """
    keys = [_admitted(), _stream(answer_id)]
    if conversation_id is not None:
        keys.append(_waiting(conversation_id))
    admitted = connection().admit(
        keys=keys,
        args=[
            settings.QA_MAX_IN_FLIGHT,
            QUEUED_LEASE_SECONDS,
            str(answer_id),
            type(first).NAME,
            first.model_dump_json(),
            "" if owner is None else str(owner),
            QUEUED_LEASE_SECONDS + KEPT_SECONDS,
        ],
    )
    return bool(admitted)


def renew(answer_id: UUID) -> Renewal:
    """Extend a running answer's lease, and say whether it should go on.

    `stopped` when someone asked it to stop, `lost` when the lease ran out
    first, and then it is not extended: the answer's place is someone else's.
    """
    # redis-py types every reply as `Awaitable | Any`, one signature for its
    # sync and async clients; the casts here name what the sync one returns.
    return cast(
        "Renewal",
        connection().renew(
            keys=[_admitted(), _stop(answer_id)], args=[str(answer_id), RUNNING_LEASE_SECONDS]
        ),
    )


def take(answer_id: UUID) -> Renewal:
    """A worker's first renewal, which also marks the question as taken: from
    then on a lease that runs out is a dead writer, not a question that waited
    too long (`probe`). The mark lives as long as a stream no event follows."""
    return cast(
        "Renewal",
        connection().renew(
            keys=[_admitted(), _stop(answer_id), _taken(answer_id)],
            args=[str(answer_id), RUNNING_LEASE_SECONDS, QUEUED_LEASE_SECONDS + KEPT_SECONDS],
        ),
    )


def emit(answer_id: UUID, event: Event) -> None:
    """Append one event; the stream is kept `KEPT_SECONDS` past it."""
    pipe = connection().client.pipeline(transaction=False)
    pipe.xadd(_stream(answer_id), {"event": type(event).NAME, "data": event.model_dump_json()})
    pipe.expire(_stream(answer_id), KEPT_SECONDS)
    pipe.execute()


def finish(answer_id: UUID, last: Event | None, *, conversation_id: UUID | None) -> None:
    """Write the last event, if any, and give the place back."""
    keys = [_admitted(), _stream(answer_id), _stop(answer_id)]
    if conversation_id is not None:
        keys.append(_waiting(conversation_id))
    connection().finish(
        keys=keys,
        args=[
            str(answer_id),
            "" if last is None else type(last).NAME,
            "" if last is None else last.model_dump_json(),
            KEPT_SECONDS,
        ],
    )


def abandon(answer_id: UUID, *, conversation_id: UUID | None) -> None:
    """Undo `admit` for a question that never reached the queue."""
    finish(answer_id, None, conversation_id=conversation_id)
    connection().client.delete(_stream(answer_id))


def stop(answer_id: UUID) -> None:
    """Ask the worker to stop; it notices within a second (apps/qa/tasks.py)."""
    connection().client.set(_stop(answer_id), 1, ex=STOP_SECONDS)


def join(answer_id: UUID) -> Reader:
    """Count one more reader of the answer, pushing the oldest out past
    `MAX_READERS`. Both keys outlive any relay (apps/qa/views.py) by being
    kept `KEPT_SECONDS` past the last join."""
    reader_id = uuid.uuid4().hex
    joined = connection().join(
        keys=[_readers(answer_id), _joins(answer_id)],
        args=[reader_id, MAX_READERS, KEPT_SECONDS],
    )
    return Reader(id=reader_id, seen=cast("str", joined))


def leave(answer_id: UUID, reader: Reader) -> None:
    """Give the reader's place back."""
    connection().client.lrem(_readers(answer_id), 0, reader.id)


def read(
    answer_id: UUID,
    after: str,
    *,
    block: float = READ_BLOCK_SECONDS,
    reader: Reader | None = None,
) -> list[Entry]:
    """The entries after `after` ("0" for all), waiting up to `block` seconds
    for the first; empty when none arrived.

    With `reader`, another reader's join wakes the wait too, and a join that
    pushed `reader` out raises `PushedOutError` instead.
    """
    streams: dict[KeyT, StreamIdT] = {_stream(answer_id): after}
    if reader is not None:
        streams[_joins(answer_id)] = reader.seen
    replies = cast(
        "list[tuple[str, list[tuple[str, dict[str, str]]]]] | None",
        connection().client.xread(streams, block=round(block * 1000)),
    )
    entries: list[Entry] = []
    for key_name, items in replies or ():
        if key_name == _stream(answer_id):
            entries.extend(
                Entry(id=entry_id, name=fields["event"], data=fields["data"])
                for entry_id, fields in items
            )
        elif reader is not None:
            reader.seen = items[-1][0]
            if connection().client.lpos(_readers(answer_id), reader.id) is None:
                raise PushedOutError
    return entries


def probe(answer_id: UUID, after: str) -> Probe:
    """After a read came back empty: `more` if events arrived since, `alive`
    if the writer still holds its lease, `dead` if it lost it once a worker
    took the question, `untaken` if before (a question that waited for a
    worker longer than its lease, a busy site's or one where no worker
    consumes `qa`), `gone` if the stream itself has expired."""
    return cast(
        "Probe",
        connection().probe(
            keys=[_admitted(), _stream(answer_id), _taken(answer_id)],
            args=[str(answer_id), after],
        ),
    )


def owner(answer_id: UUID) -> str | None:
    """The account the answer was asked by, as its id; empty for an anonymous
    question, None when the stream is gone."""
    first = cast(
        "list[tuple[str, dict[str, str]]]", connection().client.xrange(_stream(answer_id), count=1)
    )
    if not first:
        return None
    _entry_id, fields = first[0]
    return fields.get("owner")


def answering(conversation_id: UUID) -> UUID | None:
    """The answer the conversation is waiting for, if one is in flight."""
    value = cast("str | None", connection().client.get(_waiting(conversation_id)))
    return None if value is None else UUID(value)
