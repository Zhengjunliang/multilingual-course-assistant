"""The gold smoke check is the M2 tuning signal: a hit must mean the right
file AND the right page inside the chunk's span, and the CLI must report a
rate that survives an empty index without dividing by zero."""

from pathlib import Path

import pytest
from test_index import StubDense, StubSparse, make_chunk
from test_search import ORM_TEXT

from rag.gold import GoldQuestion, is_hit, load_gold, main, missing_answer_refs
from rag.index import ensure_collection, index_chunks, open_client
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
