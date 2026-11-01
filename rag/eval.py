"""The M3 evaluation: retrieval and generation measured apart, per locale, on
a frozen index (docs/architecture.md, row "Evaluation"; the reasons are in
docs/decisions.md, 2026-11-01, *Retrieval and generation are measured apart*).

Two steps, so that a judge never shares a card with the model it judges and
frozen answers can be judged again. `generate` retrieves every gold question
from its `target` collection, as the smoke gate does, and ranks the top 10
with and without the reranker; it answers as the site does, from the
reranker's top `TOP_K` above `RELEVANCE_CUTOFF`, at temperature 0 and seed 0.
The answers, with their contexts and reference answers, are frozen in
data/eval/<run_id>/answers.jsonl, outside git; the run's numbers and identity
go to eval/<run_id>.json, in git, and hold no text. `judge` scores the frozen
answers with RAGAS (rag/judge.py) and adds its numbers and identity to the
same file.

Each question's numbers are kept under `questions`; every block above them is
summed from there, so the two steps cannot disagree about a total.

    uv run python -m rag.eval generate gold/smoke.jsonl --index-snapshot data/snapshots/<time>
    uv run python -m rag.eval judge --run-id <run_id>
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import shutil
import subprocess
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel, ConfigDict

from rag.chunk import detect_locale
from rag.gold import EVAL_SCOPE, first_hit_rank, load_gold, missing_answer_refs
from rag.llm import trace
from rag.probe import configure_cli_logging
from rag.search import DEFAULT_RERANK_MODEL, RELEVANCE_CUTOFF, TOP_K, build_reranker, search

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Sequence

    from pydantic import SecretStr
    from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)

ARTEFACT_DIR = Path("eval")
ANSWERS_DIR = Path("data/eval")

# BEIR's and MTEB's cut-offs up to 10; MRR reads the same top 10, a question
# with no hit there scoring 0.
K_VALUES = (1, 3, 5, 10)
RANK_DEPTH = 10

# The two retrieval arms: the reranker's order, which the site answers from,
# and the fusion order alone, the M3 no-rerank baseline.
ARMS = ("rerank", "fusion")

# The generator's decoding: greedy and seeded, so two runs can be compared.
SAMPLING: dict[str, Any] = {"temperature": 0.0, "seed": 0}

# The four RAGAS metrics, under the names the artefact gives them.
METRICS = ("faithfulness", "answer_relevancy", "context_precision", "context_recall")

# An answer true to its contexts but not to its question, `[febbraio]`'s kind,
# is listed when faithfulness reaches this and answer relevancy stays below it:
# the midpoint of both scales.
FLAG_THRESHOLD = 0.5


class FrozenAnswer(BaseModel):
    """One line of answers.jsonl: everything `judge` reads, so it needs
    neither the index nor the gold files."""

    model_config = ConfigDict(frozen=True)

    id: str
    locale: str
    question: str
    reference: str
    contexts: list[str]
    answer: str
    refused: bool


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def code_identity() -> dict[str, Any]:
    """The commit the run's code is, and whether the tree held changes on top."""
    git = shutil.which("git")
    if git is None:
        return {"commit": None, "dirty": None}

    def run(*args: str) -> str | None:
        reply = subprocess.run(  # noqa: S603 - fixed argv, no shell, no user input
            [git, *args], capture_output=True, text=True, check=False
        )
        return reply.stdout.strip() if reply.returncode == 0 else None

    commit = run("rev-parse", "HEAD")
    if commit is None:
        return {"commit": None, "dirty": None}
    return {"commit": commit, "dirty": bool(run("status", "--porcelain"))}


def server_identity(base_url: str, api_key: SecretStr) -> dict[str, Any]:
    """What the OpenAI-compatible server says it is: vLLM answers `GET
    /version` beside `/v1`, Ollama `GET /api/version`; None from any other."""
    root = base_url.rstrip("/").removesuffix("/v1")
    headers = {"Authorization": f"Bearer {api_key.get_secret_value()}"}
    for path in ("/version", "/api/version"):
        try:
            reply = httpx.get(root + path, headers=headers, timeout=10.0)
        except httpx.HTTPError:
            return {"version": None}
        if reply.is_success:
            return {"version": reply.json().get("version")}
    return {"version": None}


def index_identity(client: QdrantClient) -> dict[str, Any]:
    """The points of each collection, and of each ingest run of the web one,
    read when the run starts: a number measured on another index cannot pass
    for this one's."""
    from rag.index import COLLECTION, WEB_COLLECTION

    identity: dict[str, Any] = {}
    for collection in (COLLECTION, WEB_COLLECTION):
        if not client.collection_exists(collection):
            continue
        entry: dict[str, Any] = {"points": client.count(collection, exact=True).count}
        if collection == WEB_COLLECTION:
            facets = client.facet(collection, key="ingest_run_id", limit=1000, exact=True)
            entry["runs"] = {str(hit.value): hit.count for hit in facets.hits}
        identity[collection] = entry
    return identity


def snapshot_identity(directory: Path, points: dict[str, Any]) -> dict[str, Any]:
    """The frozen index the run claims to read (`rag.snapshot`'s manifest),
    refused when the index holds other points than the snapshot did."""
    manifest = json.loads((directory / "manifest.json").read_bytes())
    collections: dict[str, Any] = manifest["collections"]
    held = {name: entry["points"] for name, entry in points.items()}
    taken = {name: entry["points"] for name, entry in collections.items()}
    if held != taken:
        raise SystemExit(
            f"the index holds {held} points, the snapshot {directory} {taken}: "
            "restore the snapshot before a run that names it"
        )
    return {
        "directory": directory.name,
        "taken_at": manifest["taken_at"],
        "sha256": {name: entry["sha256"] for name, entry in collections.items()},
    }


def retrieval_summary(ranks: Sequence[int | None]) -> dict[str, Any]:
    """hit@k as counts, the gates' N/M, and MRR@10 as a mean."""
    summary: dict[str, Any] = {"questions": len(ranks)}
    for k in K_VALUES:
        summary[f"hit@{k}"] = sum(rank is not None and rank <= k for rank in ranks)
    reciprocal = [1 / rank if rank is not None and rank <= RANK_DEPTH else 0.0 for rank in ranks]
    summary[f"mrr@{RANK_DEPTH}"] = sum(reciprocal) / len(reciprocal) if reciprocal else 0.0
    return summary


def metric_summary(values: Iterable[Any]) -> dict[str, Any]:
    """A metric's mean over the questions it scored, beside the count of each
    reason it scored none: a failure averaged as 0 would mix the judge's
    failures with the system's."""
    scored: list[float] = []
    unscored = {"nan": 0, "failed": 0, "refused": 0}
    for value in values:
        if isinstance(value, str):
            unscored[value] += 1
        else:
            scored.append(float(value))
    return {"mean": sum(scored) / len(scored) if scored else None, "scored": len(scored)} | (
        unscored
    )


def by_locale(
    questions: dict[str, Any],
    summarise: Callable[[list[Any]], Any],
    read: Callable[[dict[str, Any]], Any],
) -> dict[str, Any]:
    """`summarise` over every question, then over each locale's alone."""
    rows: list[dict[str, Any]] = list(questions.values())
    groups = {"all": rows} | {
        locale: [row for row in rows if row["locale"] == locale]
        for locale in sorted({row["locale"] for row in rows})
    }
    return {name: summarise([read(row) for row in group]) for name, group in groups.items()}


def rate(matches: list[Any]) -> float | None:
    return sum(matches) / len(matches) if matches else None


def rank_in(arm: str) -> Callable[[dict[str, Any]], Any]:
    return lambda row: row["rank"][arm]


def score_of(metric: str) -> Callable[[dict[str, Any]], Any]:
    return lambda row: row["scores"][metric]


def faithful_but_irrelevant(scores: dict[str, Any]) -> bool:
    faithfulness, relevancy = scores["faithfulness"], scores["answer_relevancy"]
    return (
        not isinstance(faithfulness, str)
        and not isinstance(relevancy, str)
        and faithfulness >= FLAG_THRESHOLD
        and relevancy < FLAG_THRESHOLD
    )


def summarise(artefact: dict[str, Any]) -> None:
    """Sum the per-question numbers into the blocks above them, in place."""
    questions: dict[str, Any] = artefact["questions"]
    artefact["retrieval"] = {
        arm: by_locale(questions, retrieval_summary, rank_in(arm)) for arm in ARMS
    }
    answered = {key: row for key, row in questions.items() if not row["refused"]}
    artefact["answers"] |= {
        "refused": by_locale(questions, sum, lambda row: row["refused"]),
        "language_consistency": by_locale(
            answered, rate, lambda row: row["answer_locale"] == row["locale"]
        ),
    }
    flags: dict[str, list[str]] = {
        "language_mismatch": sorted(
            key for key, row in answered.items() if row["answer_locale"] != row["locale"]
        )
    }
    if all("scores" in row for row in questions.values()):
        artefact["generation"] = {
            metric: by_locale(questions, metric_summary, score_of(metric)) for metric in METRICS
        }
        flags["faithful_but_irrelevant"] = sorted(
            key for key, row in questions.items() if faithful_but_irrelevant(row["scores"])
        )
    artefact["flags"] = flags


def write_artefact(artefact: dict[str, Any]) -> Path:
    path = ARTEFACT_DIR / f"{artefact['run_id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(artefact, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    return path


def generate(args: argparse.Namespace) -> None:
    from config.env import env
    from rag.answer import answer
    from rag.index import build_dense_encoder, build_sparse_encoder, open_client
    from rag.llm import build_streamer

    questions = load_gold(args.gold_file)
    # The reference answers live outside git (gold/README.md), and the judge
    # needs them: stop before a GPU is spent on a run that cannot be judged.
    missing = missing_answer_refs(questions, Path())
    if missing:
        raise SystemExit(f"reference answers missing for {', '.join(missing)}")

    run_id = args.run_id or "eval-" + datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    print(f"run_id: {run_id}")
    client = open_client(args.qdrant)
    points = index_identity(client)
    snapshot = (
        snapshot_identity(args.index_snapshot, points) if args.index_snapshot is not None else None
    )
    dense = build_dense_encoder(args.dense_model)
    sparse = build_sparse_encoder()
    reranker = build_reranker(args.rerank_model)
    streamer = build_streamer(env.llm_base_url, env.llm_api_key, env.llm_model, **SAMPLING)

    rows: dict[str, Any] = {}
    frozen: list[FrozenAnswer] = []
    for question in questions:
        common: dict[str, Any] = {
            "scope": EVAL_SCOPE,
            "collections": (question.target,),
            "ingest_source": args.ingest_source,
            "ingest_run_id": args.snapshot,
        }
        rank = {
            arm: first_hit_rank(
                question,
                search(
                    client,
                    question.question,
                    dense,
                    sparse,
                    arm_reranker,
                    limit=RANK_DEPTH,
                    **common,
                ),
            )
            for arm, arm_reranker in zip(ARMS, (reranker, None), strict=True)
        }
        hits = search(
            client,
            question.question,
            dense,
            sparse,
            reranker,
            limit=TOP_K,
            min_score=RELEVANCE_CUTOFF,
            **common,
        )
        with trace(
            "eval",
            metadata={"run_id": run_id, "question_id": question.id},
            input=question.question,
        ) as observation:
            text = "".join(answer(question.question, hits, streamer, question.locale))
            observation.update(output=text)
        frozen.append(
            FrozenAnswer(
                id=question.id,
                locale=question.locale,
                question=question.question,
                reference=Path(question.answer_ref).read_text(encoding="utf-8"),
                contexts=[hit.chunk.text for hit in hits],
                answer=text,
                refused=not hits,
            )
        )
        rows[question.id] = {
            "locale": question.locale,
            "rank": rank,
            "refused": not hits,
            "answer_locale": detect_locale(text),
        }
        print(f"{question.id} rerank {rank['rerank']} fusion {rank['fusion']}")
    client.close()

    answers_path = ANSWERS_DIR / run_id / "answers.jsonl"
    answers_path.parent.mkdir(parents=True, exist_ok=True)
    answers_path.write_bytes(
        "".join(row.model_dump_json() + "\n" for row in frozen).encode("utf-8")
    )
    artefact: dict[str, Any] = {
        "run_id": run_id,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "code": code_identity(),
        "gold": {"path": args.gold_file.as_posix(), "sha256": sha256_of(args.gold_file)},
        "index": {
            "points": points,
            "snapshot": snapshot,
            "ingest_source": args.ingest_source,
            "ingest_run_id": args.snapshot,
        },
        "retrieval_settings": {
            "dense_model": args.dense_model,
            "rerank_model": args.rerank_model,
            "rank_depth": RANK_DEPTH,
            "top_k": TOP_K,
            "relevance_cutoff": RELEVANCE_CUTOFF,
        },
        "system": {
            "model": env.llm_model,
            "revision": args.revision,
            "quantisation": args.quantisation,
            "server": server_identity(env.llm_base_url, env.llm_api_key),
            "sampling": SAMPLING,
        },
        "answers": {"path": answers_path.as_posix(), "sha256": sha256_of(answers_path)},
        "questions": rows,
    }
    summarise(artefact)
    print(f"artefact: {write_artefact(artefact)}")


def judge(args: argparse.Namespace) -> None:
    from config.env import env
    from rag.index import build_dense_encoder
    from rag.judge import JUDGE_SAMPLING, Judge

    path = ARTEFACT_DIR / f"{args.run_id}.json"
    artefact: dict[str, Any] = json.loads(path.read_bytes())
    answers_path = Path(artefact["answers"]["path"])
    # The answers are frozen: a file changed since `generate` would be judged
    # under the identity of answers it no longer holds.
    if sha256_of(answers_path) != artefact["answers"]["sha256"]:
        raise SystemExit(f"{answers_path} changed since it was generated")
    frozen = [
        FrozenAnswer.model_validate_json(line)
        for line in answers_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    scorer = Judge(
        env.judge_base_url,
        env.judge_api_key,
        env.judge_model,
        build_dense_encoder(artefact["retrieval_settings"]["dense_model"]),
    )

    async def score_all() -> None:
        # One question at a time, as the generator answered: the judge's server
        # runs one sequence at a time for the run to repeat.
        for row in frozen:
            scores = (
                dict.fromkeys(METRICS, "refused")
                if row.refused
                else await scorer.score(row.question, row.answer, row.contexts, row.reference)
            )
            artefact["questions"][row.id]["scores"] = scores
            print(f"{row.id} {scores}")

    asyncio.run(score_all())
    artefact["judged_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    artefact["judge"] = {
        "model": env.judge_model,
        "revision": args.revision,
        "quantisation": args.quantisation,
        "server": server_identity(env.judge_base_url, env.judge_api_key),
        "sampling": JUDGE_SAMPLING,
        "ragas": version("ragas"),
    }
    summarise(artefact)
    print(f"artefact: {write_artefact(artefact)}")


def main(argv: list[str] | None = None) -> None:
    from rag.index import DEFAULT_DENSE_MODEL, add_qdrant_argument

    parser = argparse.ArgumentParser(description=__doc__)
    steps = parser.add_subparsers(dest="step", required=True)

    first = steps.add_parser("generate", help="retrieve, answer and freeze every gold question")
    first.add_argument("gold_file", type=Path)
    first.add_argument("--run-id", default=None, help="default: eval-<UTC timestamp>")
    add_qdrant_argument(first)
    first.add_argument(
        "--index-snapshot",
        type=Path,
        default=None,
        metavar="DIR",
        help="the rag.snapshot directory the index was restored from; the run "
        "stops if the index holds other points",
    )
    first.add_argument("--dense-model", default=DEFAULT_DENSE_MODEL)
    first.add_argument("--rerank-model", default=DEFAULT_RERANK_MODEL)
    # The eval-isolation rule (docs/architecture.md), as rag.gold reads it.
    first.add_argument("--ingest-source", choices=["crawl", "live"], default="crawl")
    first.add_argument(
        "--snapshot",
        metavar="run_id",
        default=None,
        help="narrow web retrieval to a single ingest run",
    )

    second = steps.add_parser("judge", help="score a generated run's frozen answers")
    second.add_argument("--run-id", required=True)

    # A served model reports its name but not its weights: the revision and the
    # quantisation are recorded as the operator states them.
    for step in (first, second):
        step.add_argument("--revision", default=None, help="the served model's HF revision")
        step.add_argument("--quantisation", default=None, help="e.g. fp16, awq")

    args = parser.parse_args(argv)
    configure_cli_logging()
    if args.step == "generate":
        generate(args)
    else:
        judge(args)


if __name__ == "__main__":
    main()
