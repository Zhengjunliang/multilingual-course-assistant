"""Question routing and the deepening fetch loop.

The agent is pure control flow and reads only (the module boundary rule,
docs/architettura.md): it routes, retrieves and hands the hits to generation.
The one write it may reach is `rag.live.fetch_and_ingest`, which owns every
decision about what enters the shared knowledge base — nothing here touches an
index write path directly.

The router is a 4B quantized model, so an unusable reply is an expected event
rather than an exception: `route()` falls back to `target="both"` and says so in
`reason`. That fallback is the frozen contract — searching both collections
costs latency, never correctness.

When the stored corpus cannot answer, `deepen()` follows links instead of
refusing: assess what was retrieved, narrow the outlink graph to a numbered
shortlist, let the model pick one — or say none of them can hold the answer —
fetch it through `rag.live`, retrieve again.
Three steps at most, and the state machine (docs/fonte-web-unifi.md owns it)
ends by answering from whatever was gathered — an honest refusal is the last
resort, not the default. A refusal still carries the one thing a student can
act on: paste the URL of the page that holds the answer.

    uv run python -m rag.agent "What is an ORM?"
    uv run python -m rag.agent "Quando scadono le tasse?" --locale it --no-rerank
    uv run python -m rag.agent "Come chiedo il Diploma Supplement?" --no-deepen
"""

from __future__ import annotations

import argparse
import logging
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict

from rag.answer import answer, format_context, print_sources
from rag.chunk import detect_locale, locale_arg
from rag.crawl import Outlink, is_pdf, latest_by_url, read_registry
from rag.index import COLLECTION, WEB_COLLECTION, DenseEncoder
from rag.live import (
    DEFAULT_REGISTRY,
    STEP_TIMEOUT_SECONDS,
    LiveResult,
    fetch_and_ingest,
    maybe_unload_llm,
    shared_robots,
    shared_throttle,
)
from rag.llm import Completer, Message, build_completer, build_streamer, complete_json
from rag.probe import configure_cli_logging
from rag.search import DEFAULT_RERANK_MODEL, Hit, build_reranker, search

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

    from rag.chunk import Chunk
    from rag.crawl import RegistryEntry

    type Retrieve = Callable[[str], list[Hit]]
    # (url, referrer, unload hook) -> what the fetch produced. The hook is the
    # loop's, not the caller's: it fires when the relevance gate has answered.
    type Fetch = Callable[[str, str | None, Callable[[], None]], LiveResult]

logger = logging.getLogger(__name__)

FALLBACK_REASON = "fallback: unparseable router reply"
ASSESS_FALLBACK_REASON = "fallback: unparseable assessment"
PICK_FALLBACK_REASON = "fallback: unparseable pick, took the top-ranked candidate"

# Hard caps, all of them code constants rather than convention
# (docs/fonte-web-unifi.md): three fetches per question, and a shortlist a 4B
# model can actually read. The two candidate quotas are independent — PDF
# attachments never spend a page slot, because one referrer page can carry
# forty decree PDFs and would otherwise flood the list on its own.
DEEPEN_MAX_STEPS = 3
MAX_LINK_CANDIDATES = 10
MAX_PDF_CANDIDATES = 5

# How many chunks of an *ephemeral* page ride into this turn's context. The gate
# refused it, so it is not in the index and retrieval cannot rank it — the loop
# ranks it instead, by the same cosine rule the outlinks are narrowed with
# (`rank_chunks`). Same order as the retrieval top-k, so the prompt stays the
# same size whichever branch the gate took.
EPHEMERAL_CHUNK_LIMIT = 5

DEFAULT_DECISION_LOG = (
    Path(__file__).resolve().parent.parent / "data" / "webcorpus" / "decisions.jsonl"
)

ROUTER_SYSTEM_PROMPT = """\
You route a student's question to the knowledge base that can answer it.

- "slides": course material — lectures, exercises, exam topics.
- "unifi_web": University of Florence campus and administrative information — \
deadlines, offices, services, enrolment, fees, DSU, housing.
- "both": the question spans both, or you are unsure.

Also rewrite the question into a short retrieval query in the language of the \
question, and set "fresh" to true only when the answer needs a page newer than a \
stored snapshot (an open call, a current deadline).

Reply with ONLY one JSON object, no prose:
{"target": "slides|unifi_web|both", "query": "...", "fresh": false, "reason": "..."}"""

ASSESS_SYSTEM_PROMPT = """\
You decide whether the excerpts already retrieved answer the student's question.

Answer "answerable": true only when the excerpts state the fact the question \
asks for. A page that merely discusses the topic, lists where to look, or names \
the right office without the answer is not an answer.

Saying false costs one more page fetch; saying true on thin material costs the \
student a wrong answer.

Reply with ONLY one JSON object, no prose:
{"answerable": false, "reason": "..."}"""

PICK_SYSTEM_PROMPT = """\
You pick the one link most likely to contain the answer to the student's \
question. The candidates are numbered and PDF attachments are marked [PDF]; \
a form or a decree is often where an administrative answer actually lives.

You are never required to pick. When none of the numbered candidates can \
plausibly contain the answer, set "unsuitable" to true instead of taking the \
least bad one: what gets fetched is stored for every later question too, so \
following a link you have already judged irrelevant costs more than leaving \
this question unanswered.

Reply with the number of exactly one candidate, or with that refusal, and ONLY \
one JSON object, no prose:
{"choice": 1, "unsuitable": false, "reason": "..."}"""


class RouteDecision(BaseModel):
    """The router's reply (fields owned by the M2.5b ROADMAP checklist).

    `target` ranges over the two real collection names plus the routing-only
    `both`; `query` is the rewritten retrieval query, while generation keeps the
    student's original wording. `fresh` is the deepening loop's only input from
    the router: it means the stored snapshot is stale by hypothesis, so the loop
    fetches before believing its own first assessment. It defaults so that a
    dropped flag costs a hint rather than the whole decision.
    """

    model_config = ConfigDict(frozen=True)

    target: Literal["slides", "unifi_web", "both"]
    query: str
    fresh: bool = False
    reason: str


class AnswerVerdict(BaseModel):
    """The loop's stop condition: do the retrieved excerpts answer this yet?"""

    model_config = ConfigDict(frozen=True)

    answerable: bool
    reason: str


class CandidateChoice(BaseModel):
    """One 1-based index into the numbered shortlist, plus why — or the refusal.

    `unsuitable` is the model saying that no candidate on the shortlist can hold
    the answer at all, and it is a real branch rather than a formality: forced
    to choose, a 4B model fetches a link it has just called irrelevant, and what
    a fetch writes lands in the *shared* knowledge base. A refusal therefore
    does not have to invent a number either, hence the default on `choice`;
    `unsuitable` itself defaults to False, so a dropped flag costs one fetch out
    of three rather than the whole turn.
    """

    model_config = ConfigDict(frozen=True)

    choice: int = 0
    unsuitable: bool = False
    reason: str


class Decision(BaseModel):
    """One row of the per-question decision log (schema owned by
    docs/fonte-web-unifi.md), the raw material for M3's error taxonomy.

    `candidates` keeps the anchor text verbatim: without it a wrong answer
    cannot be split into "the shortlist never offered the right link" and "the
    model picked the wrong one from a shortlist that did". `step` counts the
    fetches made when the row was written, so a row that ends the turn carries
    the number of hops it took. `outcome` is one of `answered` · `persisted` ·
    `already indexed` · `ephemeral` · `not retrieved` · `timeout` ·
    `no candidates` · `unsuitable` · `steps exhausted` (`unsuitable` = the
    shortlist was offered and the model rejected all of it, which is not the
    same failure as `no candidates`, where the graph had nothing to offer).
    """

    model_config = ConfigDict(frozen=True)

    run_id: str
    question_id: str
    step: int
    candidates: list[Outlink]
    choice: str | None
    reason: str
    outcome: str


@dataclass(frozen=True)
class Candidate:
    """One link the loop may follow, and the stored page that carried it.

    The referrer travels with the link rather than beside it because it is part
    of the payload contract, not bookkeeping: a web chunk names the page an
    attachment hung on (docs/docling-e-pipeline.md 3.6), and only slides chunks
    may leave it empty. A candidate that lost its source page would produce a
    stored PDF nobody can trace back to where it was linked from.
    """

    link: Outlink
    referrer: str


@dataclass(frozen=True)
class DeepenResult:
    """What the loop leaves behind: the hits generation answers from, and every
    step it took to get them."""

    hits: list[Hit]
    decisions: list[Decision]


def route(question: str, completer: Completer) -> RouteDecision:
    """An unusable reply is a routing decision too: `both` searches everything."""
    messages: list[Message] = [
        {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    decision = complete_json(completer, messages, RouteDecision)
    if decision is None:
        return RouteDecision(target="both", query=question, fresh=False, reason=FALLBACK_REASON)
    return decision


def collections_for(decision: RouteDecision) -> tuple[str, ...]:
    """`both` is the merged pool the gates never use: evaluation stays
    single-collection (rag/gold.py), only the agent retrieves across the two."""
    if decision.target == "slides":
        return (COLLECTION,)
    if decision.target == "unifi_web":
        return (WEB_COLLECTION,)
    return (COLLECTION, WEB_COLLECTION)


def pointer_line(locale: str) -> str:
    """A refusal that leaves the student nothing to do is a dead end: the shared
    knowledge base grows from the URLs they paste, so the refusal says so."""
    return {
        "it": "Se mi incolli l'URL della pagina che contiene la risposta, posso impararla.",
        "zh": "把包含答案的网页链接贴给我，我就能学会。",  # noqa: RUF001 — Chinese punctuation
    }.get(locale, "If you paste the URL of the page that contains the answer, I can learn it.")


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    """Cosine similarity over two plain float lists.

    Deliberately not numpy: a page's outlinks are hundreds of short vectors at
    most, so this loop is noise next to the encoding that produced them — and
    numpy is not a declared dependency of this project, which is reason enough
    on its own not to reach for it.
    """
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    norm = math.sqrt(sum(a * a for a in left)) * math.sqrt(sum(b * b for b in right))
    return dot / norm if norm else 0.0


def ranking_text(link: Outlink) -> str:
    """What a candidate is scored on: anchor text plus the URL path, and for a
    PDF its filename as well.

    The filename is already inside the path — repeating it is the point. A
    decree-style attachment carries no anchor sentence and no readable path
    segment, so its filename is the only text it has; counting it twice is the
    difference between ranking it and losing it in the navigation links.
    """
    path = urlsplit(link.url).path
    # No response in hand at ranking time, so the judgment is the extension's
    # half of `is_pdf` — the content type arrives only once the page is fetched.
    if is_pdf(link.url, ""):
        return f"{link.text} {Path(path).name} {path}"
    return f"{link.text} {path}"


def narrow_candidates(
    query: str, candidates: Sequence[Candidate], dense: DenseEncoder, *, link_hopping: bool = True
) -> list[Candidate]:
    """Hundreds of outlinks -> a shortlist a 4B model can choose from.

    A page carries a median of 79 non-PDF outlinks (p90 138, max 232), so a cap
    at ten discards roughly nine in ten links and the discarding rule has to be
    explicit: every candidate is embedded with the shared CPU encoder and scored
    by cosine against the rewritten query. DOM order — which is registry order —
    is forbidden as a ranking, because a page's first links are its navigation.

    PDF attachments hold a quota of their own rather than competing for the ten:
    one referrer page can link forty decrees, which would flood the shortlist,
    while capping the two kinds together would let navigation links push out the
    single attachment that answers the question.

    `link_hopping=False` is the `--no-deepen` arm: PDF attachments only, and the
    full ranked list rather than the top five. The two arms then differ in
    exactly one variable — following links — which is the only way an attribution
    between them holds.
    """
    pool = [candidate for candidate in candidates if link_hopping or is_pdf(candidate.link.url, "")]
    if not pool:
        return []
    query_vector = dense.encode_query(query)
    vectors = dense.encode_documents([ranking_text(candidate.link) for candidate in pool])
    scored = sorted(
        zip(pool, (_cosine(query_vector, vector) for vector in vectors), strict=True),
        key=lambda pair: pair[1],
        reverse=True,
    )

    page_slots = MAX_LINK_CANDIDATES
    pdf_slots = MAX_PDF_CANDIDATES if link_hopping else len(pool)
    kept: list[Candidate] = []
    for candidate, _ in scored:
        if is_pdf(candidate.link.url, ""):
            if not pdf_slots:
                continue
            pdf_slots -= 1
        else:
            if not page_slots:
                continue
            page_slots -= 1
        kept.append(candidate)
    return kept


def _carrier_row(
    entry: RegistryEntry, registry: Mapping[str, RegistryEntry]
) -> RegistryEntry | None:
    """The ledger row whose outlinks stand in for this one's.

    Only HTML pages record outlinks, so a hit that is a PDF attachment has no
    graph of its own: a question whose every top hit is an attachment could
    never deepen, which is a class of questions rather than an edge case. The
    ledger already holds the way out — an attachment row names the page that
    linked it (`referrer_url`), and that page's row carries the links. A row
    with neither outlinks nor a referrer still in the ledger contributes
    nothing, silently: there is no graph around it to read.
    """
    if entry.outlinks:
        return entry
    return registry.get(entry.referrer_url or "")


def graph_outlinks(
    hits: Sequence[Hit],
    registry: Mapping[str, RegistryEntry],
    *,
    handed_over: Sequence[Candidate] = (),
    visited: Sequence[str] = (),
) -> list[Candidate]:
    """One step's candidate pool, deduplicated by URL and minus what was already
    fetched this turn.

    Every stored page a hit came from recorded its links when it was ingested,
    so the graph is read from the ledger and each link keeps that page as its
    referrer; pages fetched during the turn hand theirs over the same way,
    through `LiveResult.outlinks`. Either way no page is ever refetched just to
    discover a candidate.

    A hit whose own row records no links — every PDF attachment — is read
    through the page that carried it instead (`_carrier_row`), and the referrer
    is that carrier page: the link is listed there, not in the attachment.

    What retrieval already surfaced is never a candidate. A carrier page lists
    the attachment it carries — that is where the crawler found it, and it holds
    for all 132 attachment rows of the first snapshot — so without this the step
    offers the hit back to itself and the loop spends one of its three fetches
    re-reading a page whose text is already in this turn's context. The
    incremental check would even call that fetch `already indexed`, whose whole
    meaning is "the index holds it and retrieval had *not* surfaced it".
    """
    surfaced = {hit.chunk.url for hit in hits if hit.chunk.url}
    recorded = [
        Candidate(link=link, referrer=source.url)
        for hit in hits
        if (entry := registry.get(hit.chunk.url or "")) is not None
        if (source := _carrier_row(entry, registry)) is not None
        for link in source.outlinks
    ]
    pool: dict[str, Candidate] = {}
    for candidate in (*recorded, *handed_over):
        # Both sources are filtered, not just the ledger's: a page fetched
        # earlier this turn links back to its section hub, and a hub is exactly
        # what retrieval tends to surface.
        url = candidate.link.url
        if url not in visited and url not in surfaced and url not in pool:
            pool[url] = candidate
    return list(pool.values())


def format_candidates(candidates: Sequence[Candidate]) -> str:
    """The numbered list the model chooses from; an anchor-less link says so
    rather than showing an empty label the model would read as noise."""
    return "\n".join(
        f"{number}. {'[PDF] ' if is_pdf(candidate.link.url, '') else ''}"
        f"{candidate.link.text or '(no anchor text)'} <{candidate.link.url}>"
        for number, candidate in enumerate(candidates, start=1)
    )


def rank_chunks(
    query: str, chunks: Sequence[Chunk], dense: DenseEncoder, limit: int
) -> list[Chunk]:
    """The best `limit` chunks of an ephemeral page, by the same cosine rule the
    outlinks are narrowed with.

    An ephemeral page is not in the index, so retrieval cannot rank it and the
    whole document would otherwise have to ride into the prompt. Taking the head
    of it instead would be a guess: a decree says what it is on page one, a
    modulo buries the deadline in the middle. The encoder is already loaded —
    the narrowing that chose this page loaded it — and this encode sits outside
    the step clock alongside the parse and the ingest encode.
    """
    if len(chunks) <= limit:
        return list(chunks)
    query_vector = dense.encode_query(query)
    vectors = dense.encode_documents([chunk.embed_text for chunk in chunks])
    ranked = sorted(
        zip(chunks, (_cosine(query_vector, vector) for vector in vectors), strict=True),
        key=lambda pair: pair[1],
        reverse=True,
    )
    return [chunk for chunk, _ in ranked[:limit]]


def assess_answerable(question: str, hits: Sequence[Hit], completer: Completer) -> AnswerVerdict:
    """The loop's stop condition, folded into one LLM judgment.

    An unusable reply reads as "not yet": another fetch is bounded by the step
    cap, while a wrong "yes" ends the turn on material that does not answer.
    """
    if not hits:
        return AnswerVerdict(answerable=False, reason="nothing retrieved yet")
    messages: list[Message] = [
        {"role": "system", "content": ASSESS_SYSTEM_PROMPT},
        {"role": "user", "content": f"{format_context(hits)}\n\nQuestion: {question}"},
    ]
    verdict = complete_json(completer, messages, AnswerVerdict)
    return verdict or AnswerVerdict(answerable=False, reason=ASSESS_FALLBACK_REASON)


def pick_candidate(
    question: str, candidates: Sequence[Candidate], completer: Completer
) -> tuple[Candidate | None, str]:
    """One choice out of the numbered shortlist with the model's reason, or
    `None` when the model judges that none of them can hold the answer.

    That refusal is deliberate and the loop stops deepening on it: a fetch
    writes to the shared knowledge base, so following a link the model has just
    called irrelevant costs every later question, not only this one.

    An unusable reply — or a number outside the list — is a different event and
    keeps its own contract: take the top-ranked candidate, which is where the
    narrowing already put its best guess. Picking wrong costs one fetch out of
    three, so there is nothing here worth raising, and a garbled reply must
    never read as a judgement the model did not make.
    """
    messages: list[Message] = [
        {"role": "system", "content": PICK_SYSTEM_PROMPT},
        {"role": "user", "content": f"{format_candidates(candidates)}\n\nQuestion: {question}"},
    ]
    choice = complete_json(completer, messages, CandidateChoice)
    if choice is not None and choice.unsuitable:
        return None, choice.reason
    if choice is None or not 1 <= choice.choice <= len(candidates):
        return candidates[0], PICK_FALLBACK_REASON
    return candidates[choice.choice - 1], choice.reason


def _timed[T](work: Callable[[], T]) -> tuple[T, float]:
    """Run `work`, report what it returned and how many seconds it took."""
    start = time.monotonic()
    result = work()
    return result, time.monotonic() - start


def _timed_fetch(
    fetch: Fetch, url: str, referrer: str | None, unload_llm: Callable[[], None] | None
) -> tuple[LiveResult, float]:
    """One live fetch, and the part of it the step clock is allowed to count.

    The fetch's share of the budget stops when the relevance gate has answered,
    which is exactly where `fetch_and_ingest` calls back to unload the LLM:
    before that callback the step is waiting on the network and on the model,
    after it the parse and the encode run under budgets of their own
    (docs/fonte-web-unifi.md). A fetch that never reached the gate — robots, a
    dead URL, an unusable content type — leaves the callback unfired and is
    counted whole, which is right: all of it was network wait.
    """
    gate_at: list[float] = []

    def on_gate_answered() -> None:
        gate_at.append(time.monotonic())
        if unload_llm is not None:
            unload_llm()

    start = time.monotonic()
    result = fetch(url, referrer, on_gate_answered)
    return result, (gate_at[0] if gate_at else time.monotonic()) - start


def deepen(
    question: str,
    decision: RouteDecision,
    completer: Completer,
    *,
    retrieve: Retrieve,
    fetch: Fetch,
    registry: Mapping[str, RegistryEntry],
    dense_encoder: Callable[[], DenseEncoder],
    run_id: str,
    question_id: str,
    unload_llm: Callable[[], None] | None = None,
    link_hopping: bool = True,
    max_steps: int = DEEPEN_MAX_STEPS,
    step_timeout: float = STEP_TIMEOUT_SECONDS,
) -> DeepenResult:
    """The deepening state machine (docs/fonte-web-unifi.md owns it).

    Retrieve, ask whether that answers the question, and if it does not, narrow
    the outlink graph to a shortlist, pick one, fetch it through `rag.live` and
    retrieve again — at most `max_steps` fetches, then answer from whatever was
    gathered. A pick step that rejects the whole shortlist ends the deepening
    the same way, one fetch earlier. Running out of steps is not a refusal:
    generation gets the hits either way and refuses only if there is nothing to
    ground on.

    A step over `step_timeout` counts as a step that did not arrive: its content
    is dropped and the loop moves to the next candidate without paying for a
    second assessment of material that has not changed. The budget covers four
    things, all of them network or model waits: the assessment, the pick, the
    fetch and the relevance gate. The assessment is in there deliberately — the
    previous step unloaded the LLM to free its VRAM, so the reload lands on the
    first call after it, which is this assessment (or the pick, when a timed-out
    step skipped the assessment), and a reload that is not charged to the step
    that triggers it is a budget that cannot be exceeded. The parse and the
    encode stay outside, under budgets of their own.

    `dense_encoder` is a provider rather than an encoder: a question the stored
    corpus already answers must not pay for loading one.
    """
    decisions: list[Decision] = []

    def record(
        step: int, candidates: Sequence[Candidate], choice: str | None, reason: str, outcome: str
    ) -> None:
        decisions.append(
            Decision(
                run_id=run_id,
                question_id=question_id,
                step=step,
                candidates=[candidate.link for candidate in candidates],
                choice=choice,
                reason=reason,
                outcome=outcome,
            )
        )

    hits = retrieve(decision.query)
    ephemeral: list[Hit] = []
    handed_over: list[Candidate] = []
    visited: list[str] = []
    fetched = 0
    # Set when a step grew the index but did not live to retrieve again.
    stale_index = False
    # `fresh` is the router saying the stored snapshot is too old to answer, so
    # the first assessment would be judging material already known to be stale.
    reassess = not decision.fresh

    while True:
        spent = 0.0
        if reassess:
            assess = partial(assess_answerable, question, [*hits, *ephemeral], completer)
            verdict, spent = _timed(assess)
            if verdict.answerable:
                record(fetched, [], None, verdict.reason, "answered")
                break
        if fetched >= max_steps:
            record(fetched, [], None, "step cap reached", "steps exhausted")
            break

        # The pool is checked before the encoder is asked for: a question the
        # stored corpus answers, or one with no graph around it, must not pay
        # for loading ~2.4GB of embedding model to narrow nothing.
        pool = graph_outlinks(hits, registry, handed_over=handed_over, visited=visited)
        if not pool:
            record(fetched, [], None, "no candidate in the outlink graph", "no candidates")
            break
        candidates = narrow_candidates(
            decision.query, pool, dense_encoder(), link_hopping=link_hopping
        )
        if not candidates:
            # `--no-deepen` with no attachment in reach: the arm exists to fetch
            # linked PDFs, and there is none.
            record(fetched, [], None, "no candidate survived the narrowing", "no candidates")
            break

        pick = partial(pick_candidate, question, candidates, completer)
        (picked, why), elapsed = _timed(pick)
        spent += elapsed
        if picked is None:
            # The model read the shortlist and rejected all of it. Fetching one
            # anyway would write a page it has just called irrelevant into the
            # shared index, so the turn stops deepening and answers from what it
            # already holds. The shortlist is recorded with the row: this is a
            # graph that offered candidates, not an empty one.
            record(fetched, candidates, None, why, "unsuitable")
            break
        fetched += 1
        url = picked.link.url
        visited.append(url)

        result, elapsed = _timed_fetch(fetch, url, picked.referrer, unload_llm)
        spent += elapsed
        if spent > step_timeout:
            logger.info("%s: step %d over budget (%.1fs), moving on", url, fetched, spent)
            record(fetched, candidates, url, why, "timeout")
            # The write already happened inside `rag.live`; only this turn's
            # view of it is discarded, so the index is now ahead of `hits`. A
            # step that only recognized an already-stored page wrote nothing,
            # so there is nothing for the catch-up retrieval to find.
            stale_index = stale_index or result.stored_now
            reassess = False  # nothing the loop may use arrived, so nothing changed
            continue

        reassess = True
        handed_over.extend(Candidate(link=link, referrer=url) for link in result.outlinks)
        if result.stored_now:
            outcome = "persisted"
        elif result.persisted:
            # The page was already in the index, unchanged, and the incremental
            # check said so: the knowledge base did not grow and retrieval had
            # simply not surfaced the page — two different signals for M3, so
            # they get two different outcomes. Nothing moved, so reassessing
            # would spend an LLM call on material already judged — unless a
            # timed-out write left the index ahead of `hits`, in which case the
            # retrieval below brings in genuinely new material that has never
            # been judged. `stale_index` is exactly that distinction.
            outcome = "already indexed"
            reassess = stale_index
        elif result.chunks:
            # Refused by the gate or cut short by the parse: readable this turn,
            # invisible to the index, so it rides along instead of being retrieved.
            outcome = "ephemeral"
            ephemeral.extend(
                Hit(chunk=chunk, score=0.0)
                for chunk in rank_chunks(
                    decision.query, result.chunks, dense_encoder(), EPHEMERAL_CHUNK_LIMIT
                )
            )
        else:
            outcome = "not retrieved"
        record(fetched, candidates, url, why, outcome)
        hits = retrieve(decision.query)
        stale_index = False

    if stale_index:
        # A step that stored a page and then blew its budget left the turn
        # answering from what the index held before it. One more retrieval costs
        # no LLM call and no fetch, and is the difference between citing what
        # was actually stored and citing what it replaced.
        hits = retrieve(decision.query)

    return DeepenResult(hits=[*hits, *ephemeral], decisions=decisions)


def append_decisions(path: Path, decisions: Sequence[Decision]) -> None:
    """Append-only ledger of what the loop chose and why, written the way
    `rag.crawl` writes the registry. Not the knowledge base: this is M3's error
    taxonomy raw material, which is why a read-only module may write it."""
    if not decisions:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for decision in decisions:
            handle.write(decision.model_dump_json() + "\n")


def main(argv: list[str] | None = None) -> None:
    from config.env import env
    from rag.crawl import HttpxFetcher
    from rag.index import (
        DEFAULT_DENSE_MODEL,
        DEFAULT_QDRANT_DIR,
        build_dense_encoder,
        build_sparse_encoder,
        cached_dense_encoder,
        open_client,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question")
    parser.add_argument(
        "--locale",
        type=locale_arg,
        default=None,
        help="answer language (BCP-47 primary subtag, e.g. en/it/zh); "
        "default: detected from the question",
    )
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--no-rerank", action="store_true")
    parser.add_argument(
        "--no-deepen",
        action="store_true",
        help="degraded arm: fetch linked PDF attachments only, never follow a page link",
    )
    parser.add_argument(
        "--question-id",
        default="ad-hoc",
        help="the id this turn is logged and triggered under (a gold question id in eval)",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="group every fetch of this turn into one rollback unit; default: live-<UTC timestamp>",
    )
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument(
        "--decision-log",
        type=Path,
        default=DEFAULT_DECISION_LOG,
        help=f"append the per-step decision rows here (default: {DEFAULT_DECISION_LOG})",
    )
    parser.add_argument("--qdrant-path", type=Path, default=DEFAULT_QDRANT_DIR)
    parser.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    parser.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    args = parser.parse_args(argv)

    if args.run_id is not None and not args.run_id.startswith("live-"):
        # Run ids are the rollback unit and `delete_by_run` only ever deletes
        # live points: a crawl-shaped id here would write points no rollback
        # command could find again.
        parser.error("--run-id must start with 'live-'")

    configure_cli_logging()
    locale = args.locale or detect_locale(args.question)
    run_id = args.run_id or "live-" + datetime.now(UTC).strftime("%Y%m%d-%H%M%S")

    # Fixed seed: the run-twice-identical gate must not rest on greedy decoding
    # alone; recorded in diario at Stage 9.
    completer = build_completer(
        env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0, seed=0
    )
    decision = route(args.question, completer)
    print(f"route: {decision.target} ({decision.reason})")

    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = None if args.no_rerank else build_reranker(args.rerank_model)
    client = open_client(args.qdrant_path)
    fetcher = HttpxFetcher()

    def retrieve(query: str) -> list[Hit]:
        return search(
            client,
            # Retrieval runs on the rewritten query; generation below keeps the
            # student's original wording, which is what the answer must address.
            query,
            dense,
            sparse,
            reranker,
            limit=args.top_k,
            collections=collections_for(decision),
        )

    def fetch(url: str, referrer: str | None, unload: Callable[[], None]) -> LiveResult:
        return fetch_and_ingest(
            url,
            fetcher=fetcher,
            completer=completer,
            client=client,
            # CPU encoder from the shared cache: the GPU already hosts the
            # retrieval embedder and the reranker.
            dense=cached_dense_encoder(args.dense_model, device="cpu"),
            sparse=sparse,
            run_id=run_id,
            trigger=args.question_id,
            referrer_url=referrer,
            registry_path=args.registry,
            # The throttle and the robots cache are the live module's shared
            # pair: a fresh throttle never waits, so 1 req/s would hold only
            # inside a single fetch.
            robots=shared_robots(fetcher),
            throttle=shared_throttle(),
            unload_llm=unload,
        )

    result = deepen(
        args.question,
        decision,
        completer,
        retrieve=retrieve,
        fetch=fetch,
        registry=latest_by_url(read_registry(args.registry)),
        dense_encoder=partial(cached_dense_encoder, args.dense_model, device="cpu"),
        run_id=run_id,
        question_id=args.question_id,
        unload_llm=lambda: maybe_unload_llm(env.llm_base_url, env.llm_model),
        link_hopping=not args.no_deepen,
    )
    client.close()

    for entry in result.decisions:
        print(f"step {entry.step}: {entry.outcome} {entry.choice or ''} ({entry.reason})")
    append_decisions(args.decision_log, result.decisions)

    streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model, temperature=0.0)
    for token in answer(args.question, result.hits, streamer, locale):
        print(token, end="", flush=True)
    print()

    if result.hits:
        print_sources(result.hits)
    else:
        print(pointer_line(locale))


if __name__ == "__main__":
    main()
