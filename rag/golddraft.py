"""Draft campus gold questions from the crawled web corpus.

The local LLM drafts, humans gate: every draft row is reviewed against its URL
(by Claude first, then the author) before promotion into `gold/campus.jsonl` —
nothing in this module writes to `gold/`. Two draft sets come out:

- `campus-draft.jsonl` — questions answerable from pages already indexed,
  stratified over the scope-table sections and cycling EN/IT/ZH so the campus
  gate can score EN/IT and report ZH (docs/fonte-web-unifi.md);
- `campus-autogrow-draft.jsonl` — questions whose answer pages are known from
  the outlink graph but deliberately NOT ingested (PDF moduli included): the
  Stage 9 autogrow exam starts from 0/N on these, so they are never scored in
  PR1.

Reference answers land next to the human-written ones in `data/gold/answers/`
(gitignored — web page excerpts follow the same copyright posture as slides).

    uv run python -m rag.golddraft data\\webchunks --out data\\golddraft
"""

from __future__ import annotations

import argparse
import logging
import random
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from rag.crawl import DEFAULT_SCOPE, SKIPPED_EXTENSIONS, read_registry, rule_for
from rag.gold import GoldQuestion
from rag.index import collect_chunk_files, load_chunks
from rag.llm import complete_json
from rag.probe import configure_cli_logging

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

    from rag.crawl import RegistryEntry

logger = logging.getLogger(__name__)

ANSWERS_DIR = Path("data") / "gold" / "answers"
DEFAULT_SEED = 20260822
# Section quotas sum to 38 (inside the 30-45 window); locales cycle IT/EN/ZH
# so every section gets every language over enough rows.
SECTION_QUOTA = {"ingegneria": 12, "servizi": 12, "international": 8, "mobilita": 6}
LOCALE_CYCLE = ("it", "en", "zh", "it", "en")  # ~40% it, ~40% en, ~20% zh
LANGUAGE_NAMES = {"it": "Italian", "en": "English", "zh": "Chinese"}
MIN_PAGE_CHARS = 300  # navigation-only pages cannot ground a question
MAX_PAGE_CHARS = 4000
# Never question candidates, crawled or not: per-person directory fragments
# (hundreds of near-identical pages, unretrievable ground truth) and site
# analytics pages (awstats links are chrome, mostly dead).
EXCLUDED_URL_PATTERNS = ("cercachi-per-", "awstats.")
AUTOGROW_TOTAL = 8
AUTOGROW_PDF_MIN = 2


class PageSample(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str
    section: str
    text: str


class DraftQA(BaseModel):
    question: str
    answer: str


def load_pages(target: Path) -> list[PageSample]:
    """Chunks regrouped per URL — the draft prompt needs the page, not a slice."""
    texts: dict[tuple[str, str], list[str]] = defaultdict(list)
    for path in collect_chunk_files(target):
        for chunk in load_chunks(path):
            if chunk.kind == "web" and chunk.url:
                texts[(chunk.url, chunk.section or "web")].append(chunk.text)
    return [
        PageSample(url=url, section=section, text="\n".join(parts)[:MAX_PAGE_CHARS])
        for (url, section), parts in texts.items()
    ]


def stratified_sample(
    pages: Sequence[PageSample], quota: dict[str, int], seed: int
) -> list[PageSample]:
    rng = random.Random(seed)  # noqa: S311 — reproducible sampling, not cryptography
    by_section: dict[str, list[PageSample]] = defaultdict(list)
    for page in pages:
        excluded = any(pattern in page.url for pattern in EXCLUDED_URL_PATTERNS)
        if len(page.text) >= MIN_PAGE_CHARS and not excluded:
            by_section[page.section].append(page)
    picked: list[PageSample] = []
    for section, wanted in quota.items():
        pool = sorted(by_section.get(section, []), key=lambda page: page.url)
        if len(pool) < wanted:
            logger.warning("%s: only %d usable pages for quota %d", section, len(pool), wanted)
        picked.extend(rng.sample(pool, min(wanted, len(pool))))
    return picked


def draft_prompt(page: PageSample, locale: str) -> list[dict[str, str]]:
    language = LANGUAGE_NAMES[locale]
    return [
        {
            "role": "system",
            "content": "You draft exam questions for a university campus information "
            "assistant. Reply with ONLY a JSON object, no prose.",
        },
        {
            "role": "user",
            "content": f"Page URL: {page.url}\n\nPage content:\n{page.text}\n\n"
            f"Write ONE natural question a student would ask in {language} that this "
            f"page answers, and a 2-3 sentence reference answer in {language} quoting "
            "the key facts. The question must be self-contained: name the specific "
            "programme, event, service or topic — never write 'this page', 'this "
            'workshop\' or \'this programme\'. JSON shape: {"question": "...", "answer": "..."}',
        },
    ]


def autogrow_prompt(url: str, anchor: str, locale: str) -> list[dict[str, str]]:
    language = LANGUAGE_NAMES[locale]
    return [
        {
            "role": "system",
            "content": "You draft exam questions for a university campus information "
            "assistant. Reply with ONLY a JSON object, no prose.",
        },
        {
            "role": "user",
            "content": f"A university page links to this document, which is NOT yet in "
            f"the knowledge base.\nLink text: {anchor}\nURL: {url}\n\n"
            f"Write ONE question in {language} a student would ask whose answer that "
            f"document should contain, and a one-sentence note in {language} of what "
            'the expected answer covers. JSON shape: {"question": "...", "answer": "..."}',
        },
    ]


def uncrawled_candidates(entries: Sequence[RegistryEntry]) -> list[tuple[str, str]]:
    """(url, anchor) pairs from the outlink graph that were never fetched but
    are in scope (or PDF attachments) — the autogrow exam pool."""
    fetched = {entry.url for entry in entries}
    seen: dict[str, str] = {}
    for entry in entries:
        for outlink in entry.outlinks:
            url = outlink.url
            lowered = url.lower()
            in_scope = rule_for(url, DEFAULT_SCOPE) is not None or lowered.endswith(".pdf")
            if (
                url not in fetched
                and url not in seen
                and in_scope
                and not lowered.endswith(SKIPPED_EXTENSIONS)
                and not any(pattern in url for pattern in EXCLUDED_URL_PATTERNS)
                and len(outlink.text) >= 15  # a nameless link cannot seed a question
            ):
                seen[url] = outlink.text
    return sorted(seen.items())


def pick_autogrow(candidates: Sequence[tuple[str, str]], seed: int) -> list[tuple[str, str]]:
    rng = random.Random(seed)  # noqa: S311 — reproducible sampling, not cryptography
    pdfs = [pair for pair in candidates if pair[0].lower().endswith(".pdf")]
    pages = [pair for pair in candidates if not pair[0].lower().endswith(".pdf")]
    wanted_pdf = min(AUTOGROW_PDF_MIN, len(pdfs))
    picked = rng.sample(pdfs, wanted_pdf)
    picked += rng.sample(pages, min(AUTOGROW_TOTAL - wanted_pdf, len(pages)))
    return picked


def write_drafts(
    rows: Iterable[GoldQuestion], answers: dict[str, str], out_path: Path, answers_dir: Path
) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    answers_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    with out_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(row.model_dump_json() + "\n")
            (answers_dir / f"{row.id}.md").write_text(answers[row.id], encoding="utf-8")
            count += 1
    return count


def main(argv: list[str] | None = None) -> None:
    from config.env import env
    from rag.llm import build_completer

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("chunks", type=Path, help="webchunks root (all runs)")
    parser.add_argument("--registry", type=Path, default=Path("data/webcorpus/registry.jsonl"))
    parser.add_argument("--out", type=Path, default=Path("data/golddraft"))
    parser.add_argument("--answers-dir", type=Path, default=ANSWERS_DIR)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--skip-campus",
        action="store_true",
        help="redraft only the autogrow set, keeping campus-draft.jsonl untouched "
        "(iterating on one half must not regenerate reviewed drafts of the other)",
    )
    args = parser.parse_args(argv)

    configure_cli_logging()
    completer = build_completer(env.llm_base_url, env.llm_api_key, env.llm_model)

    samples = (
        []
        if args.skip_campus
        else stratified_sample(load_pages(args.chunks), SECTION_QUOTA, args.seed)
    )
    rows: list[GoldQuestion] = []
    answers: dict[str, str] = {}
    for number, sample in enumerate(samples, start=1):
        locale = LOCALE_CYCLE[(number - 1) % len(LOCALE_CYCLE)]
        draft = complete_json(completer, draft_prompt(sample, locale), DraftQA)
        if draft is None:
            logger.warning("%s: draft rejected, skipping", sample.url)
            continue
        row_id = f"c{number:03d}"
        rows.append(
            GoldQuestion(
                id=row_id,
                locale=locale,
                question=draft.question,
                answer_ref=f"data/gold/answers/{row_id}.md",
                target="unifi_web",
                urls=[sample.url],
            )
        )
        answers[row_id] = f"# {row_id}\n\n{draft.answer}\n\nFonte: {sample.url}\n"
        logger.info("%s [%s] %s", row_id, locale, draft.question)
    drafted = (
        0
        if args.skip_campus
        else write_drafts(rows, answers, args.out / "campus-draft.jsonl", args.answers_dir)
    )

    grow_rows: list[GoldQuestion] = []
    grow_answers: dict[str, str] = {}
    picked = pick_autogrow(uncrawled_candidates(read_registry(args.registry)), args.seed)
    for number, (url, anchor) in enumerate(picked, start=1):
        locale = ("it", "en")[(number - 1) % 2]
        draft = complete_json(completer, autogrow_prompt(url, anchor, locale), DraftQA)
        if draft is None:
            logger.warning("%s: autogrow draft rejected, skipping", url)
            continue
        row_id = f"g{number:03d}"
        grow_rows.append(
            GoldQuestion(
                id=row_id,
                locale=locale,
                question=draft.question,
                answer_ref=f"data/gold/answers/{row_id}.md",
                target="unifi_web",
                urls=[url],
            )
        )
        grow_answers[row_id] = (
            f"# {row_id}\n\n{draft.answer}\n\nFonte attesa (non ancora nel KB): {url}\n"
            f"Ancora: {anchor}\nDa verificare al primo fetch (Stage 9).\n"
        )
        logger.info("%s [%s] %s", row_id, locale, draft.question)
    grown = write_drafts(
        grow_rows, grow_answers, args.out / "campus-autogrow-draft.jsonl", args.answers_dir
    )

    print(f"drafted {drafted} campus + {grown} autogrow -> {args.out}")


if __name__ == "__main__":
    main()
