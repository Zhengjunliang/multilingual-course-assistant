"""rag.eval: the two steps of the M3 evaluation on an embedded index, with stub
encoders, a stub generator and a stub judge: no model, no GPU, no network."""

import hashlib
import json
import shutil
import subprocess
from importlib.metadata import version
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr
from test_answer import StubStreamer
from test_index import StubDense, StubSparse, make_chunk
from test_search import ORM_TEXT, TASSE_TEXT, TASSE_URL, KeywordReranker, make_web_chunk

from rag.eval import METRICS, code_identity, main, summarise
from rag.gold import GoldQuestion
from rag.index import WEB_COLLECTION, DenseEncoder, ensure_collection, index_chunks, open_client

RUN_ID = "eval-test"
ARTEFACT = Path("eval") / f"{RUN_ID}.json"
ANSWERS = Path("data/eval") / RUN_ID / "answers.jsonl"
# What StubStreamer answers, in English whatever the question's language.
ANSWER = "An ORM maps objects to tables [1]"


def build_index(path: Path) -> None:
    """One slides point and two web points, each web point from its own crawl."""
    qdrant = open_client(path)
    ensure_collection(qdrant, StubDense().dimension())
    index_chunks(qdrant, [make_chunk(0, ORM_TEXT)], StubDense(), StubSparse())
    ensure_collection(qdrant, StubDense().dimension(), collection=WEB_COLLECTION)
    web = [
        make_web_chunk(1, TASSE_TEXT).model_copy(update={"ingest_run_id": "crawl-a"}),
        make_web_chunk(2, "Graduation sessions run three times a year.").model_copy(
            update={"url": "https://www.unifi.it/en/graduation", "ingest_run_id": "crawl-b"}
        ),
    ]
    for chunk in web:
        index_chunks(qdrant, [chunk], StubDense(), StubSparse(), WEB_COLLECTION)
    qdrant.close()


def write_manifest(directory: Path, slides: int, web: int) -> None:
    directory.mkdir()
    collections = {
        "slides": {"points": slides, "sha256": "aa" * 32},
        "unifi_web": {"points": web, "sha256": "bb" * 32},
    }
    manifest = {"taken_at": "2026-11-01T20:08:00+00:00", "collections": collections}
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


@pytest.fixture
def run_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A working directory holding an index, a gold file of one slides and one
    campus question, their reference answers, and stubs for every model."""
    monkeypatch.chdir(tmp_path)
    build_index(tmp_path / "qdrant")
    questions = [
        GoldQuestion(
            id="q001",
            locale="en",
            question="What is an ORM?",
            source_file="deck.pdf",
            page=1,
            answer_ref="data/gold/answers/q001.md",
        ),
        GoldQuestion(
            id="c001",
            locale="it",
            question=TASSE_TEXT,
            answer_ref="data/gold/answers/c001.md",
            target="unifi_web",
            urls=[TASSE_URL],
        ),
    ]
    (tmp_path / "gold.jsonl").write_text(
        "".join(question.model_dump_json() + "\n" for question in questions), encoding="utf-8"
    )
    answers = tmp_path / "data/gold/answers"
    answers.mkdir(parents=True)
    for question in questions:
        (answers / f"{question.id}.md").write_text(f"Reference for {question.id}.", "utf-8")

    def stub_dense(model_name: str) -> StubDense:
        return StubDense()

    def stub_sparse() -> StubSparse:
        return StubSparse()

    monkeypatch.setattr("rag.index.build_dense_encoder", stub_dense)
    monkeypatch.setattr("rag.index.build_sparse_encoder", stub_sparse)
    monkeypatch.setattr("rag.eval.build_reranker", lambda model_name: KeywordReranker())
    monkeypatch.setattr("rag.llm.build_streamer", lambda *args, **kwargs: StubStreamer())
    monkeypatch.setattr("rag.eval.server_identity", lambda *args: {"version": "stub"})
    return tmp_path


def generate(*flags: str) -> None:
    main(["generate", "gold.jsonl", "--qdrant", "qdrant", "--run-id", RUN_ID, *flags])


def test_run_artifact_records_snapshot_identity(run_dir: Path) -> None:
    """The artefact names the snapshot the index was restored from, and the
    points of each collection and crawl as the run found them; an index that
    holds other points than the snapshot stops the run."""
    write_manifest(run_dir / "snap", slides=1, web=2)
    generate("--index-snapshot", "snap", "--revision", "abc123", "--quantisation", "fp16")

    artefact = json.loads(ARTEFACT.read_bytes())
    assert artefact["index"]["snapshot"] == {
        "directory": "snap",
        "taken_at": "2026-11-01T20:08:00+00:00",
        "sha256": {"slides": "aa" * 32, "unifi_web": "bb" * 32},
    }
    assert artefact["index"]["points"] == {
        "slides": {"points": 1},
        "unifi_web": {"points": 2, "runs": {"crawl-a": 1, "crawl-b": 1}},
    }
    assert artefact["index"]["ingest_source"] == "crawl"
    assert artefact["system"] == {
        "model": "qwen3:4b-instruct-2507-q4_K_M",
        "revision": "abc123",
        "quantisation": "fp16",
        "server": {"version": "stub"},
        "sampling": {"temperature": 0.0, "seed": 0},
    }
    assert artefact["gold"]["sha256"] == hashlib.sha256(Path("gold.jsonl").read_bytes()).hexdigest()
    assert artefact["answers"]["sha256"] == hashlib.sha256(ANSWERS.read_bytes()).hexdigest()

    write_manifest(run_dir / "other", slides=1, web=3)
    with pytest.raises(SystemExit, match="restore the snapshot"):
        generate("--index-snapshot", "other")


def test_artefacts_of_earlier_runs_leave_the_code_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An earlier run's artefact sits uncommitted in `eval/` while the next
    run starts: the code is not dirty for it, and is for a changed source."""
    git = shutil.which("git")
    assert git is not None
    monkeypatch.chdir(tmp_path)

    def run(*args: str) -> None:
        subprocess.run(
            [git, "-c", "core.hooksPath=none", "-c", "commit.gpgsign=false", *args],
            capture_output=True,
            check=True,
        )

    run("init")
    Path("module.py").write_text("x = 1\n", encoding="utf-8")
    run("add", "module.py")
    run("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init")
    Path("eval").mkdir()
    Path("eval/eval-earlier.json").write_text("{}\n", encoding="utf-8")
    assert code_identity()["dirty"] is False

    Path("module.py").write_text("x = 2\n", encoding="utf-8")
    assert code_identity()["dirty"] is True


def test_generate_freezes_the_text_outside_the_artefact(run_dir: Path) -> None:
    """The answers file holds what the judge reads; the committed artefact
    holds numbers and identity, no excerpt, answer or reference."""
    generate()

    frozen = [json.loads(line) for line in ANSWERS.read_text(encoding="utf-8").splitlines()]
    assert [row["id"] for row in frozen] == ["q001", "c001"]
    assert frozen[1]["contexts"] == [TASSE_TEXT]
    assert frozen[1]["reference"] == "Reference for c001."
    assert frozen[1]["answer"] == ANSWER

    text = ARTEFACT.read_text(encoding="utf-8")
    for written in (ANSWER, TASSE_TEXT, ORM_TEXT, "Reference for"):
        assert written not in text
    artefact = json.loads(text)
    assert artefact["retrieval"]["rerank"]["all"]["hit@1"] == 2
    # The stub answers in English: the Italian question is listed.
    assert artefact["flags"] == {"language_mismatch": ["c001"]}
    assert artefact["answers"]["language_consistency"] == {"all": 0.5, "en": 1.0, "it": 0.0}
    assert "generation" not in artefact


def test_a_question_without_its_reference_answer_stops_the_run(run_dir: Path) -> None:
    (run_dir / "data/gold/answers/c001.md").unlink()
    with pytest.raises(SystemExit, match="c001"):
        generate()
    assert not ARTEFACT.exists()


class StubJudge:
    """Scores the Italian question faithful but irrelevant, and fails one call."""

    def __init__(self, base_url: str, api_key: SecretStr, model: str, dense: DenseEncoder) -> None:
        self.calls: list[str] = []

    async def score(
        self, question: str, answer: str, contexts: list[str], reference: str
    ) -> dict[str, float | str]:
        if question == TASSE_TEXT:
            return {
                "faithfulness": 1.0,
                "answer_relevancy": 0.2,
                "context_precision": 1.0,
                "context_recall": "failed",
            }
        return dict.fromkeys(METRICS, 0.8)


def test_judge_scores_the_frozen_answers_and_refuses_changed_ones(
    run_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    generate()
    monkeypatch.setattr("rag.judge.Judge", StubJudge)
    main(["judge", "--run-id", RUN_ID, "--revision", "judge123", "--quantisation", "awq"])

    artefact = json.loads(ARTEFACT.read_bytes())
    assert artefact["judge"]["revision"] == "judge123"
    assert artefact["judge"]["ragas"] == version("ragas")
    assert artefact["judge"]["sampling"]["extra_body"] == {
        "chat_template_kwargs": {"enable_thinking": False}
    }
    assert artefact["questions"]["c001"]["scores"]["context_recall"] == "failed"
    assert artefact["generation"]["context_recall"]["all"] == {
        "mean": 0.8,
        "scored": 1,
        "nan": 0,
        "failed": 1,
        "refused": 0,
    }
    assert artefact["flags"]["faithful_but_irrelevant"] == ["c001"]
    # The retrieval numbers `generate` wrote are still there.
    assert artefact["retrieval"]["rerank"]["all"]["hit@1"] == 2

    ANSWERS.write_bytes(ANSWERS.read_bytes().replace(b"An ORM", b"A ORM"))
    with pytest.raises(SystemExit, match="changed since it was generated"):
        main(["judge", "--run-id", RUN_ID])


def test_each_step_records_the_code_it_started_on(
    run_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A commit or a checkout during a run of hours does not rename the code
    that ran: each step reads the code as it starts, and the judge's code is
    recorded beside the generator's."""
    code = {"commit": "generate-start", "dirty": False}
    monkeypatch.setattr("rag.eval.code_identity", lambda: dict(code))

    class CommittingStreamer(StubStreamer):
        def stream(self, messages: Any) -> Any:
            code["commit"] = "during-generate"
            return super().stream(messages)

    class CommittingJudge(StubJudge):
        async def score(
            self, question: str, answer: str, contexts: list[str], reference: str
        ) -> dict[str, float | str]:
            code["commit"] = "during-judge"
            return await super().score(question, answer, contexts, reference)

    monkeypatch.setattr("rag.llm.build_streamer", lambda *args, **kwargs: CommittingStreamer())
    generate()
    code["commit"] = "judge-start"
    monkeypatch.setattr("rag.judge.Judge", CommittingJudge)
    main(["judge", "--run-id", RUN_ID])

    artefact = json.loads(ARTEFACT.read_bytes())
    assert artefact["code"] == {"commit": "generate-start", "dirty": False}
    assert artefact["judge"]["code"] == {"commit": "judge-start", "dirty": False}


def row(locale: str, rank: tuple[int | None, int | None], scores: Any, **extra: Any) -> Any:
    return {
        "locale": locale,
        "rank": {"rerank": rank[0], "fusion": rank[1]},
        "refused": False,
        "answer_locale": locale,
        "scores": scores,
    } | extra


def test_summaries_count_per_locale_and_never_average_a_failure() -> None:
    """hit@k and MRR@10 by hand, a metric's mean over the questions it scored
    beside why the others have none, and a refusal outside language consistency."""
    refused = dict.fromkeys(METRICS, "refused")
    artefact: dict[str, Any] = {
        "answers": {},
        "questions": {
            "q1": row(
                "en",
                (1, 2),
                {
                    "faithfulness": 1.0,
                    "answer_relevancy": 0.2,
                    "context_precision": 0.5,
                    "context_recall": "failed",
                },
            ),
            "q2": row(
                "en",
                (4, None),
                {
                    "faithfulness": "nan",
                    "answer_relevancy": 0.9,
                    "context_precision": 1.0,
                    "context_recall": 1.0,
                },
            ),
            "q3": row("zh", (None, None), refused, refused=True, answer_locale="en"),
            "q4": row(
                "zh",
                (2, 3),
                {
                    "faithfulness": 0.5,
                    "answer_relevancy": 0.6,
                    "context_precision": 0.0,
                    "context_recall": 0.5,
                },
                answer_locale="en",
            ),
        },
    }
    summarise(artefact)

    assert artefact["retrieval"]["rerank"]["all"] == {
        "questions": 4,
        "hit@1": 1,
        "hit@3": 2,
        "hit@5": 3,
        "hit@10": 3,
        "mrr@10": (1 + 1 / 4 + 0 + 1 / 2) / 4,
    }
    assert artefact["retrieval"]["fusion"]["zh"]["mrr@10"] == (0 + 1 / 3) / 2
    assert artefact["generation"]["faithfulness"]["all"] == {
        "mean": 0.75,
        "scored": 2,
        "nan": 1,
        "failed": 0,
        "refused": 1,
    }
    assert artefact["generation"]["context_recall"]["en"] == {
        "mean": 1.0,
        "scored": 1,
        "nan": 0,
        "failed": 1,
        "refused": 0,
    }
    assert artefact["answers"]["refused"] == {"all": 1, "en": 0, "zh": 1}
    assert artefact["answers"]["language_consistency"] == {"all": 2 / 3, "en": 1.0, "zh": 0.0}
    assert artefact["flags"] == {
        "language_mismatch": ["q4"],
        "faithful_but_irrelevant": ["q1"],
    }
