"""Routing is a 4B model's decision and the deepening loop spends real fetches
on it, so what these tests pin is the contract that makes both safe: an unusable
reply routes to `both` instead of raising, a target maps to real collection
names, and an empty retrieval refuses with the pointer that lets a student grow
the knowledge base.

The loop's own contract is the hard caps: never more than three fetches, a
shortlist chosen by cosine and never by DOM order, PDF attachments on a quota of
their own, a step over budget that moves on instead of ending the turn, a
shortlist the model rejects outright that costs no fetch at all, and exhausted
steps that still answer from whatever was gathered. All of it runs
offline — stub fetcher, stub completer, stub encoders, an embedded Qdrant under
tmp_path — and the step clock runs on a fake one."""

import hashlib
import subprocess
import sys
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal

import pytest
from test_answer import StubStreamer
from test_crawl import StubFetcher, page
from test_index import StubDense, StubSparse, make_chunk, make_web_chunk
from test_llm import StubCompleter
from test_search import ORM_TEXT

from rag.agent import (
    ASSESS_FALLBACK_REASON,
    EPHEMERAL_CHUNK_LIMIT,
    MAX_LINK_CANDIDATES,
    MAX_PDF_CANDIDATES,
    PICK_FALLBACK_REASON,
    ROUTER_SYSTEM_PROMPT,
    Candidate,
    Decision,
    RouteDecision,
    assess_answerable,
    collections_for,
    deepen,
    graph_outlinks,
    main,
    narrow_candidates,
    pointer_line,
    route,
)
from rag.answer import Turn
from rag.chunk import Chunk
from rag.crawl import Outlink, RegistryEntry, Throttle, append_registry, read_registry
from rag.index import COLLECTION, WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.live import (
    LiveResult,
    RelevanceVerdict,
    live_chunker,
    live_html_converter,
    live_pdf_converter,
    shared_robots,
    shared_throttle,
)
from rag.llm import Completer, Message
from rag.parse import ParsedMeta
from rag.search import Hit

Fetch = Callable[[str, str | None, Callable[[], None]], LiveResult]

BASE_DIR = Path(__file__).resolve().parent.parent

SLIDES_REPLY = '{"target": "slides", "query": "ORM definition", "fresh": false, "reason": "course"}'
WEB_REPLY = (
    '{"target": "unifi_web", "query": "diploma supplement", "fresh": false, "reason": "campus"}'
)

# One reply that validates as both an assessment and a pick: pydantic ignores the
# fields the other schema does not declare, which keeps a loop test to one canned
# reply instead of a script that has to predict every call.
KEEP_LOOKING = '{"answerable": false, "choice": 1, "reason": "keep looking"}'
ANSWERABLE = '{"answerable": true, "reason": "the excerpts state it"}'
RELEVANT = '{"relevant": true, "reason": "campus page"}'
# The pick step's refusal, and it names no candidate on purpose: a model that
# has just rejected the whole shortlist must not have to invent a number to
# say so.
UNSUITABLE = '{"unsuitable": true, "reason": "none of these can hold the answer"}'
# The same refusal from a model that copied the prompt's example shape anyway.
UNSUITABLE_WITH_CHOICE = (
    '{"choice": 2, "unsuitable": true, "reason": "none of these can hold the answer"}'
)

QUERY = "diploma supplement"
SEED = "https://ingegneria.unifi.it/vp-185-per-laurearsi.html"
HUB = "https://ingegneria.unifi.it/vp-220-diploma-supplement.html"
ANSWER_PDF = "https://ingegneria.unifi.it/upload/sub/modulo-diploma-supplement.pdf"
ROBOTS = "https://ingegneria.unifi.it/robots.txt"

RUN_ID = "live-20260823-120000"

NOTHING = LiveResult(
    persisted=False,
    stored_now=False,
    chunks=[],
    outlinks=[],
    verdict=RelevanceVerdict(relevant=False, reason="stub"),
)

# What `rag.live` hands back when the incremental check recognizes a page: the
# index holds it, this fetch did not put it there, and its outlinks came off the
# ledger row rather than a parse.
ALREADY_INDEXED = LiveResult(
    persisted=True,
    stored_now=False,
    chunks=[],
    outlinks=[],
    verdict=RelevanceVerdict(relevant=True, reason="campus page"),
)


class ScriptedCompleter:
    """One canned reply per call, in order: the router sees one question at a
    time, so a report over N questions needs N scripted replies."""

    def __init__(self, replies: Sequence[str]) -> None:
        self.replies = list(replies)
        self.questions: list[str] = []

    def complete(self, messages: Sequence[Message]) -> str:
        self.questions.append(messages[-1]["content"])
        return self.replies.pop(0)


class CountingCompleter:
    """`StubCompleter` plus a call count: the step-clock rules are about how
    many LLM calls a step is allowed to pay for, which is only assertable if
    the calls are counted."""

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls = 0

    def complete(self, messages: Sequence[Message]) -> str:
        self.calls += 1
        return self.reply


class KeywordDense:
    """A dense encoder whose cosine ordering is legible by construction: one
    axis per keyword plus a constant one that keeps every vector non-zero, so a
    ranking string pointing the same way as the query outranks one that merely
    repeats a single word. Four dimensions, matching `StubDense`, because the
    shared CPU encoder is also what the live path indexes with."""

    WORDS = ("diploma", "supplement", "borsa")

    def dimension(self) -> int:
        return len(self.WORDS) + 1

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self.encode_query(text) for text in texts]

    def encode_query(self, text: str) -> list[float]:
        lowered = text.lower()
        return [float(lowered.count(word)) for word in self.WORDS] + [0.1]


class StubFetch:
    """Stands in for `rag.live.fetch_and_ingest`: records what the loop asked
    for and fires the gate hook the step clock stops on."""

    def __init__(self, results: Mapping[str, LiveResult] | None = None) -> None:
        self.results = dict(results or {})
        self.calls: list[str] = []

    def __call__(self, url: str, referrer: str | None, unload: Callable[[], None]) -> LiveResult:
        self.calls.append(url)
        unload()
        return self.results.get(url, NOTHING)


@pytest.fixture(autouse=True)
def _fresh_process_caches() -> Iterator[None]:
    """The live module's converters, chunker, throttle and robots cache are
    process-wide on purpose; a loop test must not inherit another test's stubs."""
    providers = (
        live_chunker,
        live_pdf_converter,
        live_html_converter,
        shared_throttle,
        shared_robots,
    )
    for provider in providers:
        provider.cache_clear()
    yield
    for provider in providers:
        provider.cache_clear()


def link(text: str, path: str) -> Outlink:
    return Outlink(url=f"https://ingegneria.unifi.it{path}", text=text)


def candidate(text: str, path: str, referrer: str = SEED) -> Candidate:
    """A link plus the stored page that carried it — the pair the loop ranks,
    because the referrer has to survive as far as the registry row."""
    return Candidate(link=link(text, path), referrer=referrer)


def entry(url: str, outlinks: Sequence[Outlink] = (), referrer: str | None = None) -> RegistryEntry:
    return RegistryEntry(
        url=url,
        content_hash="aa" * 32,
        fetch_date="2026-08-23",
        ingest_run_id="crawl-20260822-143647",
        referrer_url=referrer,
        outlinks=list(outlinks),
    )


def web_hit(url: str) -> Hit:
    return Hit(chunk=make_web_chunk("aa" * 32, "crawl", url), score=1.0)


def hub_registry() -> dict[str, RegistryEntry]:
    """A seed page already in the ledger, carrying one link: the referrer page
    the loop is meant to hop to."""
    return {SEED: entry(SEED, [link("Diploma Supplement", "/vp-220-diploma-supplement.html")])}


def make_decision(target: Literal["slides", "unifi_web", "both"]) -> RouteDecision:
    return RouteDecision(target=target, query="q", fresh=False, reason="r")


def run_loop(
    completer: Completer,
    *,
    hits: Sequence[Hit],
    registry: Mapping[str, RegistryEntry],
    fetch: Fetch,
    query: str = QUERY,
    retrieve: Callable[[str], list[Hit]] | None = None,
    **options: Any,
) -> tuple[list[Hit], list[Decision]]:
    """One deepening run over a fixed retrieval: the loop's collaborators are
    all injected, so nothing here touches a network, a model or an index."""
    result = deepen(
        "Come chiedo il Diploma Supplement?",
        RouteDecision(target="unifi_web", query=query, fresh=False, reason="campus"),
        completer,
        retrieve=retrieve or (lambda _: list(hits)),
        fetch=fetch,
        registry=registry,
        dense_encoder=KeywordDense,
        run_id=RUN_ID,
        question_id="g001",
        **options,
    )
    return result.hits, result.decisions


def test_unparseable_reply_falls_back_to_both() -> None:
    """The fallback is the frozen contract: both collections cost latency, a
    raised exception costs the answer."""
    decision = route("Quando scadono le tasse?", StubCompleter("sorry, I cannot do JSON"))
    assert decision.target == "both"
    assert decision.query == "Quando scadono le tasse?"  # untouched question, not a rewrite
    assert decision.fresh is False
    assert decision.reason.startswith("fallback")


def test_valid_reply_round_trips_every_field() -> None:
    completer = StubCompleter(
        '{"target": "unifi_web", "query": "scadenza tasse universitarie", '
        '"fresh": true, "reason": "administrative deadline"}'
    )
    decision = route("Quando scadono le tasse?", completer)
    assert decision.target == "unifi_web"
    assert decision.query == "scadenza tasse universitarie"
    assert decision.fresh is True
    assert decision.reason == "administrative deadline"
    assert completer.messages[-1]["content"] == "Quando scadono le tasse?"


def test_reply_without_fresh_still_validates() -> None:
    """A 4B model dropping the flag must cost the hint, not the whole routing
    decision — the deepening loop reads `fresh` as "fetch before believing the
    snapshot", so its default has to be the conservative one."""
    completer = StubCompleter('{"target": "slides", "query": "ORM", "reason": "course topic"}')
    decision = route("What is an ORM?", completer)
    assert decision.target == "slides"
    assert decision.fresh is False


# The prompt the 22/32 routing accuracy in docs/diario-sperimentale.md was
# measured against. Pinned rather than described, because every guard below is
# otherwise circular: they compare new code to new code, so a prompt edit would
# keep them all green while quietly retiring the number the thesis reports.
# Changing this constant is allowed — rerunning the 32-question routing report
# in the same commit is what makes it allowed.
ROUTER_PROMPT_SHA256 = "8bc4c4908d75741799721031e6424420f2ee2130614f476764505dcdb78134c8"

ORM_REPLY = '{"target": "slides", "query": "ORM", "fresh": false, "reason": "course topic"}'


def test_the_router_prompt_is_the_one_the_reported_accuracy_was_measured_with() -> None:
    assert hashlib.sha256(ROUTER_SYSTEM_PROMPT.encode()).hexdigest() == ROUTER_PROMPT_SHA256


def test_a_question_with_no_history_reaches_the_router_exactly_as_before() -> None:
    """Conversations must be free for the first question of one.

    The whole messages list is compared, not the question inside it: a change to
    the system prompt or to the number of messages is precisely what would move
    the fallback count without touching anything a routing assertion reads.
    """
    without = StubCompleter(ORM_REPLY)
    empty = StubCompleter(ORM_REPLY)

    route("What is an ORM?", without)
    route("What is an ORM?", empty, history=())

    assert without.messages == empty.messages
    assert without.messages[-1]["content"] == "What is an ORM?"


def test_history_puts_the_earlier_questions_ahead_of_this_one() -> None:
    """What makes a pronoun routable: "it" has no antecedent on its own."""
    completer = StubCompleter(ORM_REPLY)

    route(
        "How does it differ from Active Record?",
        completer,
        history=[
            Turn(question="What is an ORM?", answer="An ORM maps objects to tables."),
            Turn(question="Which one does Django use?", answer="Django's own."),
        ],
    )

    content = completer.messages[-1]["content"]
    assert content.index("What is an ORM?") < content.index("Which one does Django use?")
    assert content.endswith("Question: How does it differ from Active Record?")


def test_the_router_never_sees_an_earlier_answer() -> None:
    """The reason `format_history_questions` exists.

    An answer is full of citation markers, and a web marker is a unifi.it URL.
    Three turns of those in front of a 4B router is a standing argument for
    `unifi_web` on every question that follows, whatever the question is about.
    """
    completer = StubCompleter(ORM_REPLY)

    route(
        "What is an ORM?",
        completer,
        history=[
            Turn(
                question="Quando scadono le tasse?",
                answer="Scadono il 30 novembre [https://www.unifi.it/it/tasse · 2026-08-01].",
            )
        ],
    )

    prompt = "".join(message["content"] for message in completer.messages)
    assert "Quando scadono le tasse?" in prompt
    assert "30 novembre" not in prompt
    assert "unifi.it" not in prompt


def test_collections_for_maps_each_target_to_real_collection_names() -> None:
    assert collections_for(make_decision("slides")) == (COLLECTION,)
    assert collections_for(make_decision("unifi_web")) == (WEB_COLLECTION,)
    assert collections_for(make_decision("both")) == (COLLECTION, WEB_COLLECTION)


def test_narrowing_keeps_a_link_dom_order_would_have_dropped() -> None:
    """The whole reason the ranking exists: a page's first links are its
    navigation, so an implementation that kept registry order would return ten
    menu entries and drop the one link that answers the question."""
    navigation = [candidate(f"Sezione {number}", f"/vp-{number}.html") for number in range(12)]
    answer_link = candidate("Diploma Supplement", "/vp-220-diploma-supplement.html")

    candidates = narrow_candidates(QUERY, [*navigation, answer_link], KeywordDense())

    assert len(candidates) == MAX_LINK_CANDIDATES
    assert candidates[0] == answer_link  # last in DOM order, first by cosine
    assert candidates[0].referrer == SEED  # and it still knows which page carried it


def test_pdf_candidates_hold_a_quota_that_never_costs_a_page_slot() -> None:
    """One referrer page can link forty decrees. A shared cap would let them
    flood the shortlist; a shared *ranking* would let navigation links push out
    the single attachment that answers the question. Hence two quotas."""
    navigation = [candidate(f"Sezione {number}", f"/vp-{number}.html") for number in range(12)]
    answer_link = candidate("Diploma Supplement", "/vp-220-diploma-supplement.html")
    attachments = [
        candidate(f"Modulo diploma supplement {number}", f"/upload/diploma-supplement-{number}.pdf")
        for number in range(8)
    ]

    candidates = narrow_candidates(QUERY, [*attachments, *navigation, answer_link], KeywordDense())

    pdfs = [one for one in candidates if one.link.url.endswith(".pdf")]
    pages = [one for one in candidates if not one.link.url.endswith(".pdf")]
    assert len(pdfs) == MAX_PDF_CANDIDATES
    assert len(pages) == MAX_LINK_CANDIDATES
    assert answer_link in pages  # the attachments took none of the page slots


def test_narrowing_returns_at_most_ten_pages_in_cosine_order() -> None:
    """Three legible grades: a link pointing the same way as the query, one that
    over-weights half of it, and navigation that matches nothing."""
    best = candidate("Diploma Supplement", "/vp-220.html")
    second = candidate("Diploma Supplement", "/diploma.html")  # the same words, skewed
    third = candidate("Diploma", "/vp-221.html")  # half the query
    navigation = [candidate(f"Sezione {number}", f"/vp-{number}.html") for number in range(12)]

    candidates = narrow_candidates(QUERY, [*navigation, third, second, best], KeywordDense())

    assert len(candidates) == MAX_LINK_CANDIDATES
    assert [one.link.url for one in candidates[:3]] == [
        best.link.url,
        second.link.url,
        third.link.url,
    ]


def test_a_pdf_hit_deepens_through_the_page_that_carried_it() -> None:
    """Every top hit being a PDF must not blind the loop. An attachment's
    registry row records no outlinks — only HTML pages do — so the graph around
    it is empty and a whole class of questions could never deepen at all. The
    ledger holds the way out already: the row names the page the attachment hung
    on, and that page's links are this step's candidates."""
    # The carrier lists the attachment among its links — it is where the crawler
    # found it, so this holds for every attachment row of the real snapshot. The
    # hit must not come back as a candidate for itself.
    carrier = entry(
        SEED,
        [
            link("Diploma Supplement", "/vp-220-diploma-supplement.html"),
            link("Modulo", "/upload/sub/modulo-diploma-supplement.pdf"),
        ],
    )
    registry = {ANSWER_PDF: entry(ANSWER_PDF, referrer=SEED), SEED: carrier}
    fetch = StubFetch()

    pool = graph_outlinks([web_hit(ANSWER_PDF)], registry)

    assert [one.link.url for one in pool] == [HUB]  # and ANSWER_PDF is not offered back
    assert pool[0].referrer == SEED  # the page that lists the link, never the PDF
    # The carrier page being a hit in its own right must not offer its links twice.
    assert graph_outlinks([web_hit(ANSWER_PDF), web_hit(SEED)], registry) == pool
    # Nor may a page fetched earlier this turn hand a current hit back as a
    # candidate: a fetched page links to its section hub, and hubs are what
    # retrieval surfaces.
    handed_over = [candidate("Modulo", "/upload/sub/modulo-diploma-supplement.pdf")]
    assert graph_outlinks([web_hit(ANSWER_PDF)], registry, handed_over=handed_over) == pool

    run_loop(
        StubCompleter(KEEP_LOOKING), hits=[web_hit(ANSWER_PDF)], registry=registry, fetch=fetch
    )

    assert fetch.calls == [HUB]  # and the loop really hops, instead of stopping on an empty graph


@pytest.mark.parametrize("referrer", [None, "https://ingegneria.unifi.it/vp-999-sparita.html"])
def test_an_attachment_the_ledger_cannot_trace_back_offers_no_candidates(
    referrer: str | None,
) -> None:
    """The fallback is a ledger lookup, not a guess: an attachment row naming no
    referrer, or naming a page the ledger does not hold, has no graph to read and
    contributes nothing — silently, and without costing the turn."""
    pool = graph_outlinks([web_hit(ANSWER_PDF)], {ANSWER_PDF: entry(ANSWER_PDF, referrer=referrer)})

    assert pool == []


def test_the_loop_never_fetches_more_than_three_times_and_answers_from_what_it_got() -> None:
    """The hard cap, and what happens when it is reached: running out of steps
    is not a refusal — the ephemeral page the gate refused along the way is
    still part of what generation answers from."""
    refused = make_web_chunk("cc" * 32, "live", HUB).model_copy(
        update={"text": "orario segreteria"}
    )
    fetch = StubFetch(
        {
            HUB: LiveResult(
                persisted=False,
                stored_now=False,
                chunks=[refused],
                outlinks=[],
                verdict=RelevanceVerdict(relevant=False, reason="commercial page"),
            )
        }
    )
    outlinks = [
        link("Diploma Supplement", "/vp-220-diploma-supplement.html"),
        link("Diploma", "/vp-221.html"),
        link("Supplement", "/vp-222.html"),
        link("Sezione", "/vp-1.html"),
    ]
    hits = [web_hit(SEED)]

    answered, decisions = run_loop(
        CountingCompleter(KEEP_LOOKING),
        hits=hits,
        registry={SEED: entry(SEED, outlinks)},
        fetch=fetch,
    )

    assert len(fetch.calls) == 3
    assert len(set(fetch.calls)) == 3  # never the same candidate twice
    assert fetch.calls[0] == HUB  # cosine order, not registry order
    assert [decision.outcome for decision in decisions] == [
        "ephemeral",
        "not retrieved",
        "not retrieved",
        "steps exhausted",
    ]
    assert refused in [hit.chunk for hit in answered]  # readable this turn all the same


def test_no_deepen_fetches_only_attachments_and_keeps_the_whole_ranked_list() -> None:
    """The degraded arm isolates one variable — following page links — so it
    inherits the cosine ranking and drops only the top-5 truncation. Keeping the
    cap too would couple both arms to the same suspect component."""
    attachments = [
        link(f"Decreto {number}", f"/upload/decreto-{number}.pdf") for number in range(8)
    ]
    answer_attachment = link("Modulo Diploma Supplement", "/upload/modulo-diploma-supplement.pdf")
    pages = [link("Diploma Supplement", "/vp-220-diploma-supplement.html")]
    fetch = StubFetch()

    _, decisions = run_loop(
        StubCompleter(KEEP_LOOKING),
        hits=[web_hit(SEED)],
        registry={SEED: entry(SEED, [*pages, *attachments, answer_attachment])},
        fetch=fetch,
        link_hopping=False,
    )

    candidates = decisions[0].candidates
    assert len(candidates) == 9  # every attachment, no top-5 truncation
    assert all(candidate.url.endswith(".pdf") for candidate in candidates)
    assert candidates[0] == answer_attachment  # ranked, just not truncated
    assert all(url.endswith(".pdf") for url in fetch.calls)  # no page was ever hopped to


def test_a_question_with_no_graph_around_it_gathers_nothing_to_answer_from() -> None:
    """The refusal path of the same state machine: no outlink graph and nothing
    retrieved leaves generation with an empty candidate set, which `rag.answer`
    turns into an honest refusal rather than a guess."""
    fetch = StubFetch()

    answered, decisions = run_loop(StubCompleter(KEEP_LOOKING), hits=[], registry={}, fetch=fetch)

    assert fetch.calls == []
    assert answered == []
    assert [decision.outcome for decision in decisions] == ["no candidates"]


@pytest.mark.parametrize(
    ("before_gate", "outcome"),
    [(10.0, "persisted"), (90.0, "timeout")],
)
def test_the_step_clock_stops_when_the_relevance_gate_answers(
    before_gate: float, outcome: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The budget ruling in one assertion. The 60s step clock covers four
    things, all of them network or model waits: the assessment, the pick, the
    fetch and the relevance gate. The assessment is in there because the
    previous step unloaded the LLM, so the reload is paid on the first call
    after it and a reload nobody is charged for is a budget nobody can exceed.
    The parse and the encode behind the gate run on budgets of their own — a
    CPU encode of one page's chunks measures 117s, so counting it here would
    mark every single successful ingest as a step that never arrived."""
    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])

    def fetch(url: str, referrer: str | None, unload: Callable[[], None]) -> LiveResult:
        now[0] += before_gate  # network wait plus the gate: on the clock
        unload()
        now[0] += 300.0  # parse and encode: off it, by their own budgets
        return LiveResult(
            persisted=True,
            stored_now=True,
            chunks=[],
            outlinks=[],
            verdict=RelevanceVerdict(relevant=True, reason="ok"),
        )

    _, decisions = run_loop(
        StubCompleter(KEEP_LOOKING),
        hits=[web_hit(SEED)],
        registry={SEED: entry(SEED, [link("Diploma Supplement", "/vp-220.html")])},
        fetch=fetch,
    )

    assert decisions[0].outcome == outcome


def test_a_fetch_that_never_reaches_the_gate_is_counted_whole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half of the same rule: robots.txt refusing, a dead URL or an
    unusable content type all end the fetch before the gate, so the unload hook
    never fires and there is no boundary to stop the clock at. Every second of
    it was network wait, so every second of it counts."""
    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])

    def refused_before_the_gate(
        url: str, referrer: str | None, unload: Callable[[], None]
    ) -> LiveResult:
        now[0] += 90.0  # a slow robots.txt and a dead URL behind it
        return LiveResult(
            persisted=False,
            stored_now=False,
            chunks=[],
            outlinks=[],
            verdict=RelevanceVerdict(relevant=False, reason="fetch: page not retrieved"),
        )

    _, decisions = run_loop(
        StubCompleter(KEEP_LOOKING),
        hits=[web_hit(SEED)],
        registry={SEED: entry(SEED, [link("Diploma Supplement", "/vp-220.html")])},
        fetch=refused_before_the_gate,
    )

    assert decisions[0].outcome == "timeout"


def test_a_persisted_step_that_blew_its_budget_still_reaches_the_answer() -> None:
    """A timed-out step drops what it saw, but `rag.live` already wrote the page
    to the shared index — the write is not undone by the clock. Ending the turn
    on the pre-fetch hits would cite what the new version replaced, so one last
    retrieval runs before generation. It costs no LLM call and no fetch."""
    before = web_hit(SEED)
    after = web_hit(HUB)
    # Two retrievals only: the opening one, then the closing one the timed-out
    # persist earns. Nothing in between — the timed-out step skips it by design.
    retrievals = [[before], [before, after]]
    fetch = StubFetch(
        {
            HUB: LiveResult(
                persisted=True,
                stored_now=True,
                chunks=[],
                outlinks=[],
                verdict=RelevanceVerdict(relevant=True, reason="ok"),
            )
        }
    )

    answered, decisions = run_loop(
        StubCompleter(KEEP_LOOKING),
        hits=[before],
        registry=hub_registry(),
        fetch=fetch,
        retrieve=lambda _: retrievals.pop(0),
        step_timeout=-1.0,
    )

    assert [decision.outcome for decision in decisions] == ["timeout", "no candidates"]
    assert answered == [before, after]  # the stored page reached generation after all


def test_an_already_indexed_page_is_recorded_apart_and_costs_no_reassessment() -> None:
    """The incremental skip seen from the loop. "The knowledge base grew" and
    "retrieval had simply not surfaced this page" are different M3 signals, so
    they get different outcomes. And since the index did not move, neither did
    the hits: paying an "answerable?" call to re-judge identical material would
    spend the next step's budget on a question already answered — the rule the
    timed-out branch follows for the same reason."""
    completer = CountingCompleter(KEEP_LOOKING)
    fetch = StubFetch({HUB: ALREADY_INDEXED})

    _, decisions = run_loop(completer, hits=[web_hit(SEED)], registry=hub_registry(), fetch=fetch)

    assert fetch.calls == [HUB]
    assert [decision.outcome for decision in decisions] == ["already indexed", "no candidates"]
    assert completer.calls == 2  # one assessment and one pick, never a second assessment


def test_an_already_indexed_step_over_budget_earns_no_catch_up_retrieval() -> None:
    """The catch-up retrieval exists because a timed-out step had already written
    a page this turn never saw. A step that only recognized an already-stored
    page wrote nothing, so there is nothing to catch up on."""
    retrievals: list[str] = []

    def retrieve(query: str) -> list[Hit]:
        retrievals.append(query)
        return [web_hit(SEED)]

    _, decisions = run_loop(
        StubCompleter(KEEP_LOOKING),
        hits=[web_hit(SEED)],
        registry=hub_registry(),
        fetch=StubFetch({HUB: ALREADY_INDEXED}),
        retrieve=retrieve,
        step_timeout=-1.0,
    )

    assert [decision.outcome for decision in decisions] == ["timeout", "no candidates"]
    assert len(retrievals) == 1  # the opening one, and no closing one


def test_an_unparseable_assessment_reads_as_not_yet_and_keeps_the_loop_going() -> None:
    """A 4B model failing to produce JSON must not end the turn as "answered":
    the loop reads it as "not yet", which costs one fetch out of a bounded
    three, while the opposite reading would answer from material nobody judged."""
    question = "Come chiedo il Diploma Supplement?"
    verdict = assess_answerable(question, [web_hit(SEED)], StubCompleter("not json"))
    assert verdict.answerable is False
    assert verdict.reason == ASSESS_FALLBACK_REASON

    fetch = StubFetch()
    _, decisions = run_loop(
        ScriptedCompleter(["not json", '{"choice": 1, "reason": "the modulo"}', ANSWERABLE]),
        hits=[web_hit(SEED)],
        registry={SEED: entry(SEED, [link("Diploma Supplement", "/vp-220.html")])},
        fetch=fetch,
    )

    assert len(fetch.calls) == 1  # it kept going instead of stopping on the bad reply
    assert decisions[-1].outcome == "answered"


@pytest.mark.parametrize(
    "reply",
    [
        '{"choice": 99, "reason": "nonsense"}',  # a number outside the two-entry list
        '{"reason": "no number at all"}',  # the field dropped: `choice` defaults to 0
    ],
)
def test_a_pick_outside_the_shortlist_falls_back_to_the_top_ranked_candidate(reply: str) -> None:
    """The numbered list has two entries and the model answers "99", or drops the
    field entirely. Raising would cost the turn; the ranking already put its best
    guess first, so that is what gets fetched — and the log says the choice was
    not the model's. The range guard carries the defaulted 0 as well: without it
    `candidates[0 - 1]` would silently take the last-ranked candidate."""
    fetch = StubFetch()

    _, decisions = run_loop(
        ScriptedCompleter([KEEP_LOOKING, reply, ANSWERABLE]),
        hits=[web_hit(SEED)],
        registry={
            SEED: entry(
                SEED,
                [
                    link("Sezione", "/vp-1.html"),
                    link("Diploma Supplement", "/vp-220-diploma-supplement.html"),
                ],
            )
        },
        fetch=fetch,
    )

    assert fetch.calls == [HUB]  # the top-ranked candidate, not the first in the list
    assert decisions[0].reason == PICK_FALLBACK_REASON


def test_an_unparseable_pick_falls_back_instead_of_reading_as_a_refusal() -> None:
    """A garbled reply and a deliberate refusal must stay two different events.
    A reply that does not validate keeps the older contract — fetch the
    top-ranked candidate and record that the choice was not the model's — while
    a refusal stops the loop; collapsing them would make a broken 4B reply cost
    the turn, and make the decision log unable to tell the two apart."""
    fetch = StubFetch()

    _, decisions = run_loop(
        ScriptedCompleter([KEEP_LOOKING, "not json", ANSWERABLE]),
        hits=[web_hit(SEED)],
        registry={
            SEED: entry(
                SEED,
                [
                    link("Sezione", "/vp-1.html"),
                    link("Diploma Supplement", "/vp-220-diploma-supplement.html"),
                ],
            )
        },
        fetch=fetch,
    )

    assert fetch.calls == [HUB]  # a fetch still happened, on the ranking's best guess
    assert [decision.outcome for decision in decisions] == ["not retrieved", "answered"]
    assert decisions[0].choice == HUB  # a refusal would have recorded no choice at all
    assert decisions[0].reason == PICK_FALLBACK_REASON


@pytest.mark.parametrize("reply", [UNSUITABLE, UNSUITABLE_WITH_CHOICE])
def test_a_refused_pick_fetches_nothing_and_answers_from_what_the_turn_already_had(
    reply: str,
) -> None:
    """The forced choice was the defect: with no refusal available the model
    wrote "none of the links contain the answer ... however, since the task
    requires selecting one" and fetched an irrelevant page — into the *shared*
    knowledge base, where every later question pays for it. Rejecting the whole
    shortlist therefore stops the deepening without a fetch, and the turn still
    answers from what it holds instead of crashing or refusing.

    A refusal that also carries a number is the same refusal: the prompt's only
    example shows `choice`, so a 4B model rejecting the shortlist will often
    copy that shape and fill in a digit anyway. The flag wins — the alternative
    is fetching a page the model has just called irrelevant."""
    fetch = StubFetch()
    hits = [web_hit(SEED)]

    answered, decisions = run_loop(
        ScriptedCompleter([KEEP_LOOKING, reply]),
        hits=hits,
        registry={SEED: entry(SEED, [link("Sezione", "/vp-1.html"), link("Home", "/vp-2.html")])},
        fetch=fetch,
    )

    assert fetch.calls == []  # nothing was fetched, so nothing was written
    assert [decision.outcome for decision in decisions] == ["unsuitable"]
    assert decisions[0].choice is None
    assert len(decisions[0].candidates) == 2  # the graph did offer a shortlist: not "no candidates"
    assert decisions[0].reason == "none of these can hold the answer"  # the model's own words
    assert answered == hits  # generation still gets everything retrieval had found


def test_an_ephemeral_page_rides_in_ranked_not_truncated_at_its_head() -> None:
    """A refused page is not in the index, so retrieval cannot rank it and the
    whole document cannot ride into the prompt either. Ranking it by the same
    cosine rule the outlinks use beats taking the first chunks: the answer is as
    often in the middle of a modulo as on its first page — here it is the last
    chunk of eight, which head-of-document selection would drop."""
    filler = [
        make_web_chunk(f"{number:02d}" * 32, "live", HUB).model_copy(
            update={"chunk_id": f"filler:{number}", "embed_text": f"orario segreteria {number}"}
        )
        for number in range(7)
    ]
    buried = make_web_chunk("ff" * 32, "live", HUB).model_copy(
        update={"chunk_id": "buried", "embed_text": "diploma supplement richiesta"}
    )
    fetch = StubFetch(
        {
            HUB: LiveResult(
                persisted=False,
                stored_now=False,
                chunks=[*filler, buried],
                outlinks=[],
                verdict=RelevanceVerdict(relevant=False, reason="commercial page"),
            )
        }
    )

    answered, _ = run_loop(
        ScriptedCompleter([KEEP_LOOKING, KEEP_LOOKING, ANSWERABLE]),
        hits=[web_hit(SEED)],
        registry=hub_registry(),
        fetch=fetch,
    )

    page_ids = {"buried", *(f"filler:{number}" for number in range(7))}
    carried = [hit.chunk for hit in answered if hit.chunk.chunk_id in page_ids]
    assert len(carried) == EPHEMERAL_CHUNK_LIMIT  # the whole page never rides along
    assert buried in carried  # last in document order, first by cosine


def test_a_step_over_budget_moves_on_without_reassessing_unchanged_material() -> None:
    """A step that ran over is a step that did not arrive: its chunks are
    dropped and the loop goes straight to the next candidate, because paying an
    LLM call to reassess material that has not changed spends the next step's
    budget on a question already answered."""
    stale = make_web_chunk("dd" * 32, "live", HUB)
    fetch = StubFetch(
        {
            HUB: LiveResult(
                persisted=True,
                stored_now=True,
                chunks=[stale],
                outlinks=[],
                verdict=RelevanceVerdict(relevant=True, reason="ok"),
            )
        }
    )
    completer = CountingCompleter(KEEP_LOOKING)
    hits = [web_hit(SEED)]

    answered, decisions = run_loop(
        completer,
        hits=hits,
        registry={
            SEED: entry(
                SEED,
                [
                    link("Diploma Supplement", "/vp-220-diploma-supplement.html"),
                    link("Diploma", "/vp-221.html"),
                    link("Supplement", "/vp-222.html"),
                ],
            )
        },
        fetch=fetch,
        step_timeout=-1.0,  # every step is over budget, whatever the clock says
    )

    assert [decision.outcome for decision in decisions] == [
        "timeout",
        "timeout",
        "timeout",
        "steps exhausted",
    ]
    assert len(fetch.calls) == 3
    assert completer.calls == 4  # one assessment, then three picks
    assert answered == hits  # the timed-out step's chunks are not answered from


HUB_PAGE = (
    b'<html lang="it"><body><h1>Diploma Supplement</h1>'
    b'<a href="/vp-1-home.html">Home</a>'
    + b"".join(
        b'<a href="/upload/sub/decreto-%d.pdf">Decreto rettorale %d</a>' % (number, number)
        for number in range(7)
    )
    + b'<a href="/upload/sub/modulo-diploma-supplement.pdf">Modulo Diploma Supplement</a>'
    b"</body></html>"
)


def fake_chunk_document(
    document: object, chunker: object, meta: ParsedMeta, locale: str
) -> list[Chunk]:
    """Stands in for the real chunker, whose tokenizer is a hub download; the
    payload fields the loop reads back come from the sidecar, so they stay real."""
    return [
        make_web_chunk(meta.content_hash or "ee" * 32, "live", meta.url or "").model_copy(
            update={
                "text": f"content of {meta.url}",
                "embed_text": f"content of {meta.url}",
                "ingest_run_id": meta.ingest_run_id,
                "trigger": meta.trigger,
                "referrer_url": meta.referrer_url,
            }
        )
    ]


def test_a_two_hop_pdf_answer_is_reached_through_the_link_graph(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """End to end over the real CLI: the answer sits in an attachment two hops
    from anything the index holds, and the referrer page links eight PDFs with
    the right one last in DOM order. Reaching it means the shortlist truncated
    to five and the ranking beat document order — both at once, which is what
    the stub-level narrowing tests cannot show."""
    from docling.datamodel.base_models import ConversionStatus

    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension(), WEB_COLLECTION)
    index_chunks(
        qdrant,
        [make_web_chunk("aa" * 32, "crawl", SEED)],
        StubDense(),
        StubSparse(),
        WEB_COLLECTION,
    )
    qdrant.close()

    registry = tmp_path / "registry.jsonl"
    append_registry(
        registry, entry(SEED, [link("Diploma Supplement", "/vp-220-diploma-supplement.html")])
    )

    fetcher = StubFetcher(
        {
            ROBOTS: page(ROBOTS, b"User-agent: *\nAllow: /\n", "text/plain"),
            HUB: page(HUB, HUB_PAGE),
            ANSWER_PDF: page(ANSWER_PDF, b"%PDF-1.4 fake", "application/pdf"),
        }
    )

    class RecordingConverter:
        def convert(self, source: object, **kwargs: Any) -> Any:
            return SimpleNamespace(
                document=SimpleNamespace(texts=[]), status=ConversionStatus("success")
            )

    unloaded: list[str] = []

    monkeypatch.setattr("rag.live.build_converter", lambda *a, **k: RecordingConverter())
    monkeypatch.setattr("rag.live.build_html_converter", RecordingConverter)
    monkeypatch.setattr("rag.live.live_chunker", lambda: None)
    monkeypatch.setattr("rag.live.chunk_document", fake_chunk_document)
    monkeypatch.setattr("rag.index.build_dense_encoder", lambda model_name: StubDense())
    monkeypatch.setattr("rag.index.build_sparse_encoder", StubSparse)
    monkeypatch.setattr(
        "rag.index.cached_dense_encoder", lambda model_name, device=None: KeywordDense()
    )
    monkeypatch.setattr("rag.crawl.HttpxFetcher", lambda: fetcher)
    monkeypatch.setattr("rag.agent.shared_throttle", lambda: Throttle(interval=0.0))
    monkeypatch.setattr("rag.agent.build_streamer", lambda *a, **k: StubStreamer())
    monkeypatch.setattr(
        "rag.agent.maybe_unload_llm", lambda base_url, model: unloaded.append(model)
    )
    monkeypatch.setattr(
        "rag.agent.build_completer",
        lambda *a, **k: ScriptedCompleter(
            [
                WEB_REPLY,
                KEEP_LOOKING,  # nothing retrieved answers it
                KEEP_LOOKING,  # pick candidate 1: the referrer page
                RELEVANT,  # the gate keeps it
                KEEP_LOOKING,  # still not answerable
                KEEP_LOOKING,  # pick candidate 1: the attachment
                RELEVANT,
                ANSWERABLE,
            ]
        ),
    )

    log = tmp_path / "decisions.jsonl"
    main(
        [
            "Come chiedo il Diploma Supplement?",
            "--question-id",
            "g001",
            "--run-id",
            RUN_ID,
            "--qdrant-path",
            str(qdrant_path),
            "--registry",
            str(registry),
            "--decision-log",
            str(log),
            "--no-rerank",
        ]
    )

    out = capsys.readouterr().out
    assert "route: unifi_web (campus)" in out
    assert f"step 1: persisted {HUB}" in out
    assert f"step 2: persisted {ANSWER_PDF}" in out
    assert "step 2: answered" in out
    # The VRAM hook fires once per fetch, between the gate and the heavy work.
    assert len(unloaded) == 2

    rows = [Decision.model_validate_json(line) for line in log.read_text("utf-8").splitlines()]
    attachments = [c for c in rows[1].candidates if c.url.endswith(".pdf")]
    assert len(attachments) == MAX_PDF_CANDIDATES  # eight on the page, five offered
    assert attachments[0].url == ANSWER_PDF  # last in DOM order, first by cosine
    # The anchor text rides along verbatim, or M3 cannot tell a shortlist that
    # never offered the answer from a model that picked the wrong entry.
    assert attachments[0].text == "Modulo Diploma Supplement"
    assert rows[-1].question_id == "g001"

    # Provenance survives both hops: the ledger and the chunk payload name the
    # page each fetch was linked from, which is the payload contract for web
    # chunks (docs/docling-e-pipeline.md 3.6) and the only record of the path
    # the loop actually walked.
    ledger = {row.url: row for row in read_registry(registry)}
    assert ledger[HUB].referrer_url == SEED
    assert ledger[ANSWER_PDF].referrer_url == HUB
    stored = open_client(qdrant_path)
    points, _ = stored.scroll(WEB_COLLECTION, limit=100, with_payload=True)
    stored.close()
    by_url = {str((point.payload or {})["url"]): dict(point.payload or {}) for point in points}
    assert by_url[ANSWER_PDF]["referrer_url"] == HUB

    # Every hop of the turn is stamped with the run id the caller supplied, on
    # the chunks and on the ledger alike: the autogrow acceptance runs seven
    # questions under one id so a single `delete_by_run` rolls the whole exam
    # back, and an id minted per fetch would leave half of it behind.
    assert {
        row.ingest_run_id for row in read_registry(registry) if row.ingest_source == "live"
    } == {RUN_ID}
    assert by_url[ANSWER_PDF]["ingest_run_id"] == RUN_ID
    assert {row.run_id for row in rows} == {RUN_ID}


@pytest.fixture
def empty_index(tmp_path: Path) -> Path:
    """A real slides collection with nothing in it — retrieval succeeds and
    returns no candidate, which is the branch under test."""
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    qdrant.close()
    return qdrant_path


@pytest.mark.parametrize(
    ("locale", "refusal", "pointer"),
    [
        ("en", "could not find", "If you paste the URL"),
        ("it", "Non ho trovato", "Se mi incolli l'URL"),
    ],
)
def test_empty_retrieval_refuses_then_points_to_a_url(
    locale: str,
    refusal: str,
    pointer: str,
    empty_index: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> StubCompleter:
        assert (temperature, seed) == (0.0, 0)  # routing is pinned: greedy plus a fixed seed
        return StubCompleter(SLIDES_REPLY)

    def stub_streamer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0
    ) -> StubStreamer:
        return StubStreamer()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.crawl.HttpxFetcher", lambda: StubFetcher({}))
    monkeypatch.setattr("rag.agent.build_completer", stub_completer)
    monkeypatch.setattr("rag.agent.build_streamer", stub_streamer)

    main(
        [
            "What is an ORM?",
            "--locale",
            locale,
            "--qdrant-path",
            str(empty_index),
            "--registry",
            str(tmp_path / "registry.jsonl"),
            "--decision-log",
            str(tmp_path / "decisions.jsonl"),
            "--no-rerank",
        ]
    )
    out = capsys.readouterr().out
    assert "route: slides (course)" in out
    assert "step 0: no candidates" in out  # nothing retrieved, so nothing to follow
    assert refusal in out
    assert pointer in out
    assert "Sources:" not in out  # nothing was retrieved, so nothing may be cited


def test_cli_answers_from_the_routed_collection_with_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The routed query drives retrieval, the original question drives
    generation: the model must answer what the student actually asked."""
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    qdrant.close()

    streamer = StubStreamer()

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> ScriptedCompleter:
        assert (temperature, seed) == (0.0, 0)  # routing is pinned: greedy plus a fixed seed
        return ScriptedCompleter([SLIDES_REPLY, ANSWERABLE])

    def stub_streamer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0
    ) -> StubStreamer:
        return streamer

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.crawl.HttpxFetcher", lambda: StubFetcher({}))
    monkeypatch.setattr("rag.agent.build_completer", stub_completer)
    monkeypatch.setattr("rag.agent.build_streamer", stub_streamer)

    main(
        [
            "What is an ORM?",
            "--qdrant-path",
            str(qdrant_path),
            "--registry",
            str(tmp_path / "registry.jsonl"),
            "--decision-log",
            str(tmp_path / "decisions.jsonl"),
            "--no-rerank",
        ]
    )
    out = capsys.readouterr().out
    assert "step 0: answered" in out  # the index already had it: no fetch at all
    assert "An ORM maps objects to tables" in out
    assert "Sources:" in out
    assert "[deck.pdf p.1]" in out
    assert streamer.messages[-1]["content"].endswith("Question: What is an ORM?")


def test_cli_refuses_a_run_id_that_no_rollback_could_find() -> None:
    """The loop writes through `rag.live`, so its run id is a rollback unit:
    a crawl-shaped id would leave points no rollback command can reach."""
    with pytest.raises(SystemExit):
        main(["What is an ORM?", "--run-id", "crawl-20260822-143647"])


def test_pointer_line_covers_every_declared_locale() -> None:
    """Campus gold is roughly a third Chinese: a zh question that fell back to
    the English pointer would be a refusal the student cannot act on."""
    assert pointer_line("it").startswith("Se mi incolli")
    assert pointer_line("zh").startswith("把包含答案的网页链接")
    assert pointer_line("de") == pointer_line("en")  # unknown locales keep the English pointer


def test_importing_agent_loads_neither_docling_nor_django() -> None:
    """The agent pulls in the live write path, which pulls in the parse modules;
    docling drags torch along and costs seconds, and `rag/` must stay runnable
    without the web project at all."""
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import rag.agent, sys; print('docling' in sys.modules, 'django' in sys.modules)",
        ],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False False"
