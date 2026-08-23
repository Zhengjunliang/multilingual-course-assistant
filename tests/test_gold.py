"""The gold smoke check is the M2 tuning signal: a hit must mean the right
file AND the right page inside the chunk's span, and the CLI must report a
rate that survives an empty index without dividing by zero."""

from pathlib import Path

import pytest
from test_agent import ScriptedCompleter
from test_index import StubDense, StubSparse, make_chunk
from test_search import ORM_TEXT, TASSE_TEXT, TASSE_URL, make_web_chunk

from rag.gold import GoldQuestion, is_hit, load_gold, main, missing_answer_refs, routing_report
from rag.index import WEB_COLLECTION, ensure_collection, index_chunks, open_client
from rag.search import Hit


def make_question(page: int = 1) -> GoldQuestion:
    return GoldQuestion(
        id="q001",
        locale="en",
        question="What is an ORM?",
        source_file="deck.pdf",
        page=page,
        answer_ref="data/gold/answers/q001.md",
    )


def test_hit_requires_both_file_and_page_span() -> None:
    hits = [Hit(chunk=make_chunk(0, ORM_TEXT), score=1.0)]  # deck.pdf, pages=[1]
    assert is_hit(make_question(page=1), hits)
    assert not is_hit(make_question(page=7), hits)
    assert not is_hit(make_question(page=1), [])


def test_target_defaults_to_slides() -> None:
    assert make_question().target == "slides"
    assert make_question().urls == []


def make_campus_question() -> GoldQuestion:
    return GoldQuestion(
        id="c001",
        locale="en",
        question="How do I apply for graduation?",
        answer_ref="data/gold/answers/c001.md",
        target="unifi_web",
        urls=["https://www.ingegneria.unifi.it/vp-185-per-laurearsi.html"],
    )


def test_campus_hit_scores_by_url_not_by_page() -> None:
    """A question carrying `urls` dispatches to URL matching (trailing-slash
    insensitive); slides chunks (url=None) can never satisfy it."""
    web_chunk = make_chunk(0, ORM_TEXT).model_copy(
        update={
            "kind": "web",
            "url": "https://www.ingegneria.unifi.it/vp-185-per-laurearsi.html/",
        }
    )
    assert is_hit(make_campus_question(), [Hit(chunk=web_chunk, score=1.0)])
    assert not is_hit(make_campus_question(), [Hit(chunk=make_chunk(0, ORM_TEXT), score=1.0)])


def test_missing_answer_refs_lists_dangling_ids(tmp_path: Path) -> None:
    present = tmp_path / "data" / "gold" / "answers" / "q001.md"
    present.parent.mkdir(parents=True)
    present.write_text("answer", encoding="utf-8")
    q1 = make_question()
    q2 = q1.model_copy(update={"id": "q002", "answer_ref": "data/gold/answers/q002.md"})
    assert missing_answer_refs([q1, q2], tmp_path) == ["q002"]


def test_gold_file_round_trips(tmp_path: Path) -> None:
    path = tmp_path / "smoke.jsonl"
    path.write_text(make_question().model_dump_json() + "\n\n", encoding="utf-8")
    assert load_gold(path) == [make_question()]


def test_cli_reports_hits_and_rate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    qdrant.close()

    gold_file = tmp_path / "smoke.jsonl"
    gold_file.write_text(
        make_question(page=1).model_dump_json()
        + "\n"
        + make_question(page=7).model_dump_json()
        + "\n",
        encoding="utf-8",
    )

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)

    main([str(gold_file), "--qdrant-path", str(qdrant_path), "--no-rerank"])
    out = capsys.readouterr().out
    assert "q001 HIT " in out
    assert "q001 MISS" in out
    assert "hit@5: 1/2 (50%)" in out


def test_cli_scores_each_question_against_its_target_collection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A campus question must be answered from unifi_web and a slides question
    from slides — within one gold file, one run (the Stage 5 campus gate
    shape). Cross-collection leakage would show as a MISS on either row."""
    qdrant_path = tmp_path / "qdrant"
    qdrant = open_client(qdrant_path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    ensure_collection(qdrant, StubDense().dimension(), collection=WEB_COLLECTION)
    index_chunks(qdrant, [make_web_chunk(1, TASSE_TEXT)], StubDense(), StubSparse(), WEB_COLLECTION)
    qdrant.close()

    campus = GoldQuestion(
        id="c001",
        locale="it",
        question=TASSE_TEXT,
        answer_ref="data/gold/answers/c001.md",
        target="unifi_web",
        urls=[TASSE_URL],
    )
    gold_file = tmp_path / "campus.jsonl"
    gold_file.write_text(
        make_question(page=1).model_dump_json() + "\n" + campus.model_dump_json() + "\n",
        encoding="utf-8",
    )

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)

    main([str(gold_file), "--qdrant-path", str(qdrant_path), "--no-rerank"])
    out = capsys.readouterr().out
    assert "q001 HIT " in out
    assert "c001 HIT " in out
    assert TASSE_URL in out  # campus rows report the wanted url, not file/page
    assert "hit@5: 2/2 (100%)" in out


def record_search_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    """Replace `rag.gold`'s `search` with a recorder and stub the encoders, so a
    run reaches the call site without an index or a model behind it."""
    calls: list[dict[str, object]] = []

    def recorder(*args: object, **kwargs: object) -> list[Hit]:
        calls.append(kwargs)
        return []

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    monkeypatch.setattr("rag.gold.search", recorder)
    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    return calls


def test_cli_pins_retrieval_to_the_crawl_snapshot_by_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Eval reads the frozen crawl snapshot unless told otherwise: a live
    increment written between two runs must never move a gate number (ADR-1)."""
    calls = record_search_calls(monkeypatch)
    gold_file = tmp_path / "campus.jsonl"
    gold_file.write_text(make_campus_question().model_dump_json() + "\n", encoding="utf-8")

    main([str(gold_file), "--qdrant-path", str(tmp_path / "qdrant"), "--no-rerank"])
    capsys.readouterr()
    assert [(call["ingest_source"], call["ingest_run_id"]) for call in calls] == [("crawl", None)]


def test_cli_forwards_snapshot_and_ingest_source_to_search(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Autogrow acceptance opens the filter explicitly, and `--snapshot` narrows
    to one ingest run; both reach `search` unchanged."""
    calls = record_search_calls(monkeypatch)
    gold_file = tmp_path / "campus.jsonl"
    gold_file.write_text(make_campus_question().model_dump_json() + "\n", encoding="utf-8")

    main(
        [
            str(gold_file),
            "--qdrant-path",
            str(tmp_path / "qdrant"),
            "--no-rerank",
            "--snapshot",
            "run-x",
            "--ingest-source",
            "live",
        ]
    )
    capsys.readouterr()
    assert [(call["ingest_source"], call["ingest_run_id"]) for call in calls] == [("live", "run-x")]


def routed(target: str, reason: str = "routed") -> str:
    return f'{{"target": "{target}", "query": "q", "fresh": false, "reason": "{reason}"}}'


def test_routing_report_scores_exact_wide_both_and_fallback() -> None:
    """Four numbers because one cannot separate the failure modes: `both` is a
    wide hit and never an exact one, and a fallback is a `both` the model never
    actually chose."""
    campus = make_campus_question()
    questions = [
        make_question(),  # slides -> slides: exact and wide
        campus,  # unifi_web -> both: wide only
        campus.model_copy(update={"id": "c002"}),  # unifi_web -> slides: neither
        campus.model_copy(update={"id": "c003"}),  # unparseable -> fallback both: wide only
    ]
    completer = ScriptedCompleter(
        [routed("slides"), routed("both"), routed("slides"), "sorry, no JSON"]
    )

    report = routing_report(questions, completer)
    assert [row.routed_target for row in report.rows] == ["slides", "both", "slides", "both"]
    assert report.exact == 1
    assert report.wide == 3
    assert report.both == 2
    assert report.fallback == 1
    assert [row.id for row in report.rows if row.fallback] == ["c003"]


def test_routing_report_short_circuits_before_the_retrieval_stack(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """`--routing` is report-only: the dense/sparse/rerank stack costs ~2.4GB of
    VRAM that a report which never retrieves anything has no use for. Passing a
    retrieval flag alongside it must be called out, or `--routing --no-rerank`
    reads as a measurement of something it never touched."""

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("the routing report must not build the retrieval stack")

    def stub_completer(
        base_url: str, api_key: str, model: str, temperature: float = 0.0, seed: int | None = None
    ) -> ScriptedCompleter:
        assert (temperature, seed) == (0.0, 0)  # routing is pinned: greedy plus a fixed seed
        return ScriptedCompleter([routed("slides"), routed("both")])

    monkeypatch.setattr("rag.index.build_dense_encoder", boom)
    monkeypatch.setattr("rag.index.build_sparse_encoder", boom)
    monkeypatch.setattr("rag.index.open_client", boom)
    monkeypatch.setattr("rag.gold.build_reranker", boom)
    monkeypatch.setattr("rag.llm.build_completer", stub_completer)

    gold_file = tmp_path / "routing.jsonl"
    gold_file.write_text(
        make_question().model_dump_json() + "\n" + make_campus_question().model_dump_json() + "\n",
        encoding="utf-8",
    )

    main([str(gold_file), "--routing", "--no-rerank"])
    assert "retrieval flags ignored: no_rerank" in caplog.text
    out = capsys.readouterr().out
    assert "q001 slides -> slides" in out
    assert "c001 unifi_web -> both" in out
    assert "exact-hit: 1/2 (50%)" in out
    assert "wide-hit: 2/2 (100%)" in out
    assert "both: 1/2 (50%)" in out
    assert "fallback: 0/2 (0%)" in out
